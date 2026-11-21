#include "providers/nameflare/NameflarePaint.hpp"

#include "messages/Image.hpp"
#include "singletons/Settings.hpp"

#include <QDateTime>
#include <QLineF>
#include <QPixmap>

#include <algorithm>
#include <cmath>
#include <utility>

namespace chatterino {

namespace {

/// Flow keeps the gradient seamless by closing unequal endpoints: the first
/// colour is repeated one average stop interval after the last, and the whole
/// pattern then repeats with that closed period (Nameflare renderer contract).
QGradientStops closedStops(const QGradientStops &stops, double &period)
{
    QGradientStops closed = stops;
    const auto first = stops.front().first;
    const auto last = stops.back().first;
    const auto span = std::max(0.0, last - first);
    const auto step = stops.size() > 1 ? span / double(stops.size() - 1) : 1.0;
    if (stops.front().second != stops.back().second)
    {
        closed.append({last + std::max(step, 0.05), stops.front().second});
    }
    period = std::max(0.05, closed.back().first - first);
    return closed;
}

/// The CSS gradient line for `angle` across `rect`: the same geometry the
/// browser uses, so a Flare points the same way in chat as on the site.
QLineF cssGradientLine(const QRectF &rect, float angle)
{
    const auto radians = qDegreesToRadians(double(angle));
    const auto dx = std::sin(radians);
    const auto dy = -std::cos(radians);
    const auto half =
        (std::abs(rect.width() * dx) + std::abs(rect.height() * dy)) / 2.0;
    const QPointF center = rect.center();
    return {center - QPointF(dx, dy) * half, center + QPointF(dx, dy) * half};
}

QColor faded(QColor color, qreal opacity)
{
    color.setAlphaF(std::clamp(color.alphaF() * opacity, 0.0, 1.0));
    return color;
}

/// The layer's box inside `area`, as CSS background-size and
/// background-position place it.
QRectF layerBox(const NameflarePaint::Layer &layer, const QRectF &area)
{
    const QSizeF size(std::max(1.0, area.width() * layer.size.width()),
                      std::max(1.0, area.height() * layer.size.height()));
    return {area.left() + (area.width() - size.width()) * layer.at.x(),
            area.top() + (area.height() - size.height()) * layer.at.y(),
            size.width(), size.height()};
}

/// Every copy of `box` that a repeating background tiles across `area`.
template <typename Fn>
void forEachTile(const NameflarePaint::Layer &layer, const QRectF &box,
                 const QRectF &area, Fn &&draw)
{
    const auto startX = layer.repeatX
                            ? box.left() - std::ceil((box.left() - area.left()) /
                                                     box.width()) *
                                               box.width()
                            : box.left();
    const auto startY = layer.repeatY
                            ? box.top() - std::ceil((box.top() - area.top()) /
                                                    box.height()) *
                                              box.height()
                            : box.top();
    int guard = 0;
    for (auto y = startY;
         (layer.repeatY ? y < area.bottom() : y == startY) && guard < 400;
         y += box.height())
    {
        for (auto x = startX;
             (layer.repeatX ? x < area.right() : x == startX) && guard < 400;
             x += box.width())
        {
            draw(QRectF(x, y, box.width(), box.height()));
            guard++;
        }
    }
}

}  // namespace

NameflarePaint::NameflarePaint(QString name, QString id,
                               std::vector<Layer> layers, Timing timing,
                               std::vector<PaintDropShadow> dropShadows)
    : Paint(std::move(name), std::move(id))
    , layers_(std::move(layers))
    , timing_(timing)
    , dropShadows_(std::move(dropShadows))
{
}

const std::vector<NameflarePaint::Layer> &NameflarePaint::layers() const
{
    return this->layers_;
}

bool NameflarePaint::gradientMoves() const
{
    if (this->timing_.motion == Motion::None || !getSettings()->animateEmotes)
    {
        return false;
    }
    return std::ranges::any_of(this->layers_, [](const Layer &layer) {
        return layer.kind != Kind::Solid && layer.kind != Kind::Image &&
               layer.stops.size() > 1;
    });
}

bool NameflarePaint::animated() const
{
    if (this->gradientMoves())
    {
        return true;
    }
    return std::ranges::any_of(this->layers_, [](const Layer &layer) {
        return layer.image && layer.image->animated();
    });
}

bool NameflarePaint::loaded() const
{
    return std::ranges::all_of(this->layers_, [](const Layer &layer) {
        return !layer.image || layer.image->loaded();
    });
}

bool NameflarePaint::failed() const
{
    // Only an image-only Flare whose every image failed has nothing to draw.
    return !this->layers_.empty() &&
           std::ranges::all_of(this->layers_, [](const Layer &layer) {
               return layer.image && layer.image->loaded() &&
                      layer.image->isEmpty();
           });
}

void NameflarePaint::ensureLoaded(bool retry) const
{
    for (const auto &layer : this->layers_)
    {
        if (!layer.image)
        {
            continue;
        }
        if (retry)
        {
            layer.image->retryLoad();
        }
        else
        {
            layer.image->load();
        }
    }
}

double NameflarePaint::phaseAt(qint64 msecs) const
{
    const auto period = std::max(1000, this->timing_.periodMs);
    const bool alternate =
        this->timing_.direction == Direction::Alternate ||
        this->timing_.direction == Direction::AlternateReverse;
    const auto cycle = alternate ? qint64(period) * 2 : qint64(period);
    auto t = double(msecs % cycle) / double(period);  // 0..1 or 0..2
    if (alternate)
    {
        t = t <= 1.0 ? t : 2.0 - t;
    }
    if (this->timing_.direction == Direction::Reverse ||
        this->timing_.direction == Direction::AlternateReverse)
    {
        t = 1.0 - t;
    }
    return std::clamp(t, 0.0, 1.0);
}

double NameflarePaint::phase() const
{
    return this->gradientMoves()
               ? this->phaseAt(QDateTime::currentMSecsSinceEpoch())
               : 0.0;
}

qint64 NameflarePaint::sourcePixmapCacheKey() const
{
    // The shared pixmap cache must see a new key whenever the picture changes:
    // a new motion frame (30 per second is plenty for a name) or a new GIF frame.
    qint64 key = this->gradientMoves()
                     ? QDateTime::currentMSecsSinceEpoch() / 33
                     : 0;
    for (const auto &layer : this->layers_)
    {
        if (!layer.image)
        {
            continue;
        }
        if (const auto pixmap = layer.image->pixmapOrLoad())
        {
            key = key * 1000003 + pixmap->cacheKey();
        }
        else
        {
            key = key * 1000003 + 1;  // not loaded yet
        }
    }
    return key;
}

QBrush NameflarePaint::gradientBrush(const Layer &layer, QRectF box,
                                     double phase, qreal opacity) const
{
    const auto &stops = layer.stops;
    if (layer.kind == Kind::Solid || stops.size() == 1)
    {
        return {faded(stops.front().second, opacity)};
    }
    const bool moving = phase > 0.0;

    if (layer.kind == Kind::Conic)
    {
        // Conic Flow rotates from the original angle through one full turn.
        // Qt's conical gradients run counter-clockwise from 3 o'clock; CSS
        // runs clockwise from 12, so mirror the positions and offset by 90°.
        const QPointF center(box.left() + box.width() * layer.center.x(),
                             box.top() + box.height() * layer.center.y());
        QConicalGradient gradient(center,
                                  90.0 - double(layer.angle) - phase * 360.0);
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(1.0 - position, 0.0, 1.0),
                                faded(color, opacity));
        }
        return {gradient};
    }

    if (layer.kind == Kind::Radial)
    {
        const QPointF center(box.left() + box.width() * layer.center.x(),
                             box.top() + box.height() * layer.center.y());
        const auto radius = std::hypot(box.width(), box.height()) / 2.0;
        QRadialGradient gradient(center, radius);
        if (moving || layer.repeat)
        {
            double period = 1.0;
            const auto closed = closedStops(stops, period);
            gradient.setSpread(QGradient::RepeatSpread);
            gradient.setRadius(radius * period);
            for (const auto &[position, color] : closed)
            {
                const auto offset = std::fmod(
                    (position - closed.front().first) / period + phase, 1.0);
                gradient.setColorAt(std::clamp(offset, 0.0, 1.0),
                                    faded(color, opacity));
            }
            return {gradient};
        }
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(position, 0.0, 1.0),
                                faded(color, opacity));
        }
        return {gradient};
    }

    // Linear: the CSS gradient line, shifted along itself by one closed
    // period per cycle while moving so the sweep never jumps.
    const auto line = cssGradientLine(box, layer.angle);
    if (!moving && !layer.repeat)
    {
        QLinearGradient gradient(line.p1(), line.p2());
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(position, 0.0, 1.0),
                                faded(color, opacity));
        }
        return {gradient};
    }
    double period = 1.0;
    const auto closed = moving ? closedStops(stops, period) : stops;
    if (!moving)
    {
        period = std::max(0.05, stops.back().first - stops.front().first);
    }
    const auto start = closed.front().first + phase * period;
    QLinearGradient gradient(line.pointAt(start), line.pointAt(start + period));
    gradient.setSpread(QGradient::RepeatSpread);
    for (const auto &[position, color] : closed)
    {
        gradient.setColorAt(
            std::clamp((position - closed.front().first) / period, 0.0, 1.0),
            faded(color, opacity));
    }
    return {gradient};
}

QBrush NameflarePaint::asBrush(const QColor userColor,
                               const QRectF drawingRect) const
{
    if (this->layers_.empty() || drawingRect.isEmpty())
    {
        return {userColor};
    }
    const auto phase = this->phase();

    // Fast path: one full-size gradient or solid layer is just a brush.
    if (this->layers_.size() == 1)
    {
        const auto &layer = this->layers_.front();
        if (layer.kind != Kind::Image && !layer.stops.isEmpty() &&
            layer.size == QSizeF(1.0, 1.0) &&
            layer.blend == QPainter::CompositionMode_SourceOver)
        {
            return this->gradientBrush(layer, drawingRect, phase,
                                       layer.opacity);
        }
    }

    // Composite every layer, bottom first, into a texture the size of the
    // name, at twice the resolution so images stay sharp on HiDPI screens.
    constexpr qreal SCALE = 2.0;
    const QRectF area(QPointF(0, 0), drawingRect.size());
    QPixmap target((drawingRect.size() * SCALE).toSize());
    target.setDevicePixelRatio(SCALE);
    target.fill(Qt::transparent);

    bool drewSomething = false;
    {
        QPainter painter(&target);
        painter.setRenderHint(QPainter::SmoothPixmapTransform);
        painter.setRenderHint(QPainter::Antialiasing);
        for (const auto &layer : this->layers_)
        {
            const auto box = layerBox(layer, area);
            painter.setCompositionMode(layer.blend);
            painter.setOpacity(layer.opacity);
            if (layer.kind == Kind::Image)
            {
                const auto pixmap =
                    layer.image ? layer.image->pixmapOrLoad() : std::nullopt;
                if (!pixmap || pixmap->isNull())
                {
                    continue;  // still loading: the layer is transparent
                }
                forEachTile(layer, box, area, [&](const QRectF &tile) {
                    painter.drawPixmap(tile, *pixmap, pixmap->rect());
                });
                drewSomething = true;
                continue;
            }
            if (layer.stops.isEmpty())
            {
                continue;
            }
            forEachTile(layer, box, area, [&](const QRectF &tile) {
                painter.fillRect(tile.intersected(area),
                                 this->gradientBrush(layer, tile, phase, 1.0));
            });
            drewSomething = true;
        }
    }
    if (!drewSomething)
    {
        // Images still downloading and nothing else to show: the plain name.
        return {userColor};
    }

    QBrush brush(target);
    // The texture starts at the brush origin; line it up with the name.
    brush.setTransform(QTransform::fromTranslate(drawingRect.left(),
                                                 drawingRect.top()));
    return brush;
}

const std::vector<PaintDropShadow> &NameflarePaint::getDropShadows() const
{
    return this->dropShadows_;
}

}  // namespace chatterino
