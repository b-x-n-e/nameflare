#pragma once

#include "providers/seventv/paints/Paint.hpp"

#include <QGradient>

#include <cstdint>

#include <vector>

namespace chatterino {

/// A Nameflare Flare drawn with Moltorino's paint pipeline: the top visible
/// gradient or solid layer of a recipe, with Flow and Shimmer motion. Image
/// layers use UrlPaint instead; effects (depth, outline, glow, shadows) are
/// drop shadows built by NameflarePaints.
class NameflarePaint : public Paint
{
public:
    enum class Kind : std::uint8_t {
        Solid,
        Linear,
        Radial,
        Conic,
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

    struct Fill {
        Kind kind = Kind::Solid;
        QGradientStops stops;  // positions 0..1, ascending
        float angle = 90.F;    // CSS degrees: 0 = to top, 90 = to right
        bool repeat = false;
        QPointF center{0.5, 0.5};  // radial/conic centre in the name box
        Motion motion = Motion::None;
        Direction direction = Direction::Normal;
        int periodMs = 4000;
    };

    NameflarePaint(QString name, QString id, Fill fill,
                   std::vector<PaintDropShadow> dropShadows);

    QBrush asBrush(QColor userColor, QRectF drawingRect) const override;
    const std::vector<PaintDropShadow> &getDropShadows() const override;
    bool animated() const override;

    /// Phase of the motion cycle in [0, 1) at a point in time (for tests).
    double phaseAt(qint64 msecs) const;

private:
    qint64 sourcePixmapCacheKey() const override;
    double phase() const;

    const Fill fill_;
    const std::vector<PaintDropShadow> dropShadows_;
};

}  // namespace chatterino
