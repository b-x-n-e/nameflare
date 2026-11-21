#pragma once

#include "providers/seventv/paints/Paint.hpp"

#include <QGradient>
#include <QPainter>

#include <cstdint>
#include <memory>
#include <vector>

namespace chatterino {

class Image;
using ImagePtr = std::shared_ptr<Image>;

/// A Nameflare Flare drawn with Moltorino's paint pipeline. Every visible
/// layer of the recipe is composited bottom to top the way the site's CSS
/// renderer does it: each layer is sized to `size` percent of the name box,
/// placed at `at` percent, tiled by `canvasRepeat`, faded by `opacity` and
/// blended with `blendMode`. Gradient layers move with Flow and Shimmer;
/// image layers (PNG, WebP, GIF) animate with their own frames. Effects
/// (depth, outline, glow, shadows) are drop shadows built by NameflarePaints.
class NameflarePaint : public Paint
{
public:
    enum class Kind : std::uint8_t {
        Solid,
        Linear,
        Radial,
        Conic,
        Image,
    };
    enum class Motion : std::uint8_t {
        None,
        Flow,
    };
    enum class Direction : std::uint8_t {
        Normal,
        Reverse,
        Alternate,
        AlternateReverse,
    };

    struct Layer {
        Kind kind = Kind::Solid;
        QGradientStops stops;    // positions 0..1, ascending (no layer opacity)
        float angle = 90.F;      // CSS degrees: 0 = to top, 90 = to right
        bool repeat = false;     // repeating gradient
        QPointF center{0.5, 0.5};  // radial/conic centre in the layer box
        QSizeF size{1.0, 1.0};   // fraction of the name box (CSS background-size)
        QPointF at{0.5, 0.5};    // fraction (CSS background-position)
        bool repeatX = false;    // CSS background-repeat
        bool repeatY = false;
        qreal opacity = 1.0;
        QPainter::CompositionMode blend = QPainter::CompositionMode_SourceOver;
        ImagePtr image;          // Kind::Image only
    };

    struct Timing {
        Motion motion = Motion::None;
        Direction direction = Direction::Normal;
        int periodMs = 4000;
    };

    /// `layers` is bottom first (the order they are painted in).
    NameflarePaint(QString name, QString id, std::vector<Layer> layers,
                   Timing timing, std::vector<PaintDropShadow> dropShadows);

    QBrush asBrush(QColor userColor, QRectF drawingRect) const override;
    const std::vector<PaintDropShadow> &getDropShadows() const override;
    bool animated() const override;
    bool loaded() const override;
    bool failed() const override;
    void ensureLoaded(bool retry = false) const override;

    /// Phase of the motion cycle in [0, 1) at a point in time (for tests).
    double phaseAt(qint64 msecs) const;
    const std::vector<Layer> &layers() const;

private:
    qint64 sourcePixmapCacheKey() const override;
    double phase() const;
    bool gradientMoves() const;
    QBrush gradientBrush(const Layer &layer, QRectF box, double phase,
                         qreal opacity) const;

    const std::vector<Layer> layers_;
    const Timing timing_;
    const std::vector<PaintDropShadow> dropShadows_;
};

}  // namespace chatterino
