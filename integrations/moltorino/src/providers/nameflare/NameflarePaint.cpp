#include "providers/nameflare/NameflarePaint.hpp"

#include "singletons/Settings.hpp"

#include <QDateTime>
#include <QLineF>

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
    const auto half = (std::abs(rect.width() * dx) + std::abs(rect.height() * dy)) / 2.0;
    const QPointF center = rect.center();
    return {center - QPointF(dx, dy) * half, center + QPointF(dx, dy) * half};
}

}  // namespace

NameflarePaint::NameflarePaint(QString name, QString id, Fill fill,
                               std::vector<PaintDropShadow> dropShadows)
    : Paint(std::move(name), std::move(id))
    , fill_(std::move(fill))
    , dropShadows_(std::move(dropShadows))
{
}

bool NameflarePaint::animated() const
{
    return this->fill_.motion != Motion::None &&
           this->fill_.kind != Kind::Solid &&
           this->fill_.stops.size() > 1 && getSettings()->animateEmotes;
}

double NameflarePaint::phaseAt(qint64 msecs) const
{
    const auto period = std::max(1000, this->fill_.periodMs);
    const bool alternate = this->fill_.direction == Direction::Alternate ||
                           this->fill_.direction == Direction::AlternateReverse;
    const auto cycle = alternate ? qint64(period) * 2 : qint64(period);
    auto t = double(msecs % cycle) / double(period);  // 0..1 or 0..2
    if (alternate)
    {
        t = t <= 1.0 ? t : 2.0 - t;
    }
    if (this->fill_.direction == Direction::Reverse ||
        this->fill_.direction == Direction::AlternateReverse)
    {
        t = 1.0 - t;
    }
    return std::clamp(t, 0.0, 1.0);
}

double NameflarePaint::phase() const
{
    return this->animated()
               ? this->phaseAt(QDateTime::currentMSecsSinceEpoch())
               : 0.0;
}

qint64 NameflarePaint::sourcePixmapCacheKey() const
{
    // Animated fills change every frame; 30 steps per second is plenty for a
    // name and keeps the shared pixmap cache from churning faster than paint.
    return this->animated() ? QDateTime::currentMSecsSinceEpoch() / 33 : 0;
}

QBrush NameflarePaint::asBrush(const QColor userColor,
                               const QRectF drawingRect) const
{
    const auto &stops = this->fill_.stops;
    if (stops.empty())
    {
        return {userColor};
    }
    if (this->fill_.kind == Kind::Solid || stops.size() == 1)
    {
        return {stops.front().second};
    }

    const auto phase = this->phase();
    const bool moving = phase > 0.0;

    if (this->fill_.kind == Kind::Conic)
    {
        // Conic Flow rotates from the original angle through one full turn.
        // Qt's conical gradients run counter-clockwise from 3 o'clock; CSS
        // runs clockwise from 12, so mirror the positions and offset by 90°.
        const QPointF center(
            drawingRect.left() + drawingRect.width() * this->fill_.center.x(),
            drawingRect.top() + drawingRect.height() * this->fill_.center.y());
        QConicalGradient gradient(
            center, 90.0 - double(this->fill_.angle) - phase * 360.0);
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(1.0 - position, 0.0, 1.0), color);
        }
        return {gradient};
    }

    if (this->fill_.kind == Kind::Radial)
    {
        const QPointF center(
            drawingRect.left() + drawingRect.width() * this->fill_.center.x(),
            drawingRect.top() + drawingRect.height() * this->fill_.center.y());
        const auto radius =
            std::hypot(drawingRect.width(), drawingRect.height()) / 2.0;
        QRadialGradient gradient(center, radius);
        if (moving || this->fill_.repeat)
        {
            double period = 1.0;
            const auto closed = closedStops(stops, period);
            gradient.setSpread(QGradient::RepeatSpread);
            gradient.setRadius(radius * period);
            for (const auto &[position, color] : closed)
            {
                auto offset = std::fmod((position - closed.front().first) /
                                                period +
                                            phase,
                                        1.0);
                gradient.setColorAt(std::clamp(offset, 0.0, 1.0), color);
            }
            return {gradient};
        }
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(position, 0.0, 1.0), color);
        }
        return {gradient};
    }

    // Linear: the CSS gradient line, shifted along itself by one closed
    // period per cycle while moving so the sweep never jumps.
    const auto line = cssGradientLine(drawingRect, this->fill_.angle);
    if (!moving && !this->fill_.repeat)
    {
        QLinearGradient gradient(line.p1(), line.p2());
        for (const auto &[position, color] : stops)
        {
            gradient.setColorAt(std::clamp(position, 0.0, 1.0), color);
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
            color);
    }
    return {gradient};
}

const std::vector<PaintDropShadow> &NameflarePaint::getDropShadows() const
{
    return this->dropShadows_;
}

}  // namespace chatterino
