#include "providers/nameflare/NameflarePaints.hpp"

#ifndef NAMEFLARE_STANDALONE
#    include "mocks/BaseApplication.hpp"
#endif
#include "providers/nameflare/NameflarePaint.hpp"
#include "providers/seventv/paints/UrlPaint.hpp"
#include "singletons/Settings.hpp"
#include "Test.hpp"

#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QPainter>

using namespace chatterino;

namespace {

const QString ORIGIN = QStringLiteral("https://nameflare.example");

QJsonObject cosmetic(const char *recipeJson)
{
    return {
        {"id", "flare-1"},
        {"name", "Test Flare"},
        {"recipe", QJsonDocument::fromJson(recipeJson).object()},
    };
}

/// Fill a box with the paint's brush and sample a pixel.
QColor sample(const Paint &paint, QPointF at)
{
    QImage image(200, 40, QImage::Format_ARGB32);
    image.fill(Qt::transparent);
    QPainter painter(&image);
    painter.fillRect(QRectF(0, 0, 200, 40),
                     paint.asBrush(Qt::white, QRectF(0, 0, 200, 40)));
    painter.end();
    return image.pixelColor(at.toPoint());
}

class NameflarePaintsTest : public ::testing::Test
{
#ifndef NAMEFLARE_STANDALONE
protected:
    mock::BaseApplication app;
#endif
};

}  // namespace

TEST_F(NameflarePaintsTest, LegacyPaletteIsALinearGradientAtItsAngle)
{
    getSettings()->animateEmotes = false;
    const auto paint = NameflarePaints::paintFromCosmetic(
        cosmetic(R"({"colors":["#ff0000","#0000ff"],"animation":"none","angle":90})"),
        ORIGIN);
    ASSERT_NE(paint, nullptr);
    ASSERT_NE(dynamic_cast<NameflarePaint *>(paint.get()), nullptr);
    EXPECT_FALSE(paint->animated());
    EXPECT_EQ(paint->getName(), u"Nameflare · Test Flare");

    // 90° points right: red on the left, blue on the right.
    const auto left = sample(*paint, {2, 20});
    const auto right = sample(*paint, {197, 20});
    EXPECT_GT(left.red(), 200);
    EXPECT_LT(left.blue(), 60);
    EXPECT_GT(right.blue(), 200);
    EXPECT_LT(right.red(), 60);
}

TEST_F(NameflarePaintsTest, TopVisibleLayerWinsAndAlphaColoursKeepTheirAlpha)
{
    const auto paint = NameflarePaints::paintFromCosmetic(
        cosmetic(R"({"colors":["#ffffff","#000000"],"animation":"none","layers":[
            {"type":"linear","opacity":0,"stops":[{"at":0,"color":"#ff0000"},{"at":1,"color":"#ff0000"}]},
            {"type":"solid","opacity":1,"color":"#00ff0080"}]})"),
        ORIGIN);
    ASSERT_NE(paint, nullptr);
    const auto pixel = sample(*paint, {100, 20});
    EXPECT_GT(pixel.green(), 200);
    EXPECT_LT(pixel.red(), 40);
    EXPECT_NEAR(pixel.alpha(), 128, 2);  // #RRGGBBAA, not Qt's #AARRGGBB
}

TEST_F(NameflarePaintsTest, EffectsBecomeDropShadowsInStackingOrderAndAreCapped)
{
    const auto paint = NameflarePaints::paintFromCosmetic(
        cosmetic(R"({"colors":["#ff0000","#0000ff"],"animation":"none",
            "depth":3,"outline":1,"glow":6,"shadowOpacity":50,"shadowX":2,"shadowY":2,
            "shadows":[{"x":1,"y":1,"blur":2,"color":"#00000080"},{"x":0,"y":0,"blur":4,"color":"#ffffff40"}]})"),
        ORIGIN);
    ASSERT_NE(paint, nullptr);
    // depth 3 + outline 4 + glow 1 + legacy shadow 1 + extra shadows 2
    EXPECT_EQ(paint->getDropShadows().size(), 11U);

    const auto heavy = NameflarePaints::paintFromCosmetic(
        cosmetic(R"({"colors":["#ff0000","#0000ff"],"animation":"none",
            "depth":8,"outline":2,"glow":20,"shadowOpacity":100,
            "shadows":[{"x":1,"y":1,"blur":1,"color":"#000000"},{"x":1,"y":1,"blur":1,"color":"#000000"},
                       {"x":1,"y":1,"blur":1,"color":"#000000"},{"x":1,"y":1,"blur":1,"color":"#000000"},
                       {"x":1,"y":1,"blur":1,"color":"#000000"},{"x":1,"y":1,"blur":1,"color":"#000000"},
                       {"x":1,"y":1,"blur":1,"color":"#000000"},{"x":1,"y":1,"blur":1,"color":"#000000"}]})"),
        ORIGIN);
    ASSERT_NE(heavy, nullptr);
    EXPECT_EQ(heavy->getDropShadows().size(), 14U);  // each one is a blur pass
}

TEST_F(NameflarePaintsTest, ImageLayersOnlyLoadWellFormedTexturesFromTheOrigin)
{
    const auto image = NameflarePaints::paintFromCosmetic(
        cosmetic(R"({"colors":["#ff0000","#0000ff"],"animation":"none","layers":[
            {"type":"image","opacity":1,"textureId":"86ae5a333ab4da7858c28062a144dfd4fe54d0258992748d48cc338ba65ee045.gif"}]})"),
        ORIGIN);
    ASSERT_NE(image, nullptr);
    EXPECT_NE(dynamic_cast<UrlPaint *>(image.get()), nullptr);

    for (const auto *bad : {"../../etc/passwd", "https://evil.example/x.gif",
                            "86ae5a333ab4da7858c28062a144dfd4fe54d0258992748d48cc338ba65ee045.exe"})
    {
        auto recipe = cosmetic(R"({"colors":["#ff0000","#0000ff"],"animation":"none"})");
        auto inner = recipe["recipe"].toObject();
        inner["layers"] = QJsonArray{QJsonObject{
            {"type", "image"}, {"opacity", 1}, {"textureId", bad}}};
        recipe["recipe"] = inner;
        EXPECT_EQ(NameflarePaints::paintFromCosmetic(recipe, ORIGIN), nullptr)
            << bad;
    }
}

TEST_F(NameflarePaintsTest, FlowMovesFollowingSpeedAndDirection)
{
    getSettings()->animateEmotes = true;
    const auto make = [](const char *direction) {
        return std::dynamic_pointer_cast<NameflarePaint>(
            NameflarePaints::paintFromCosmetic(
                cosmetic(QString(R"({"colors":["#ff0000","#0000ff"],"animation":"flow","speed":4,"direction":"%1"})")
                             .arg(direction)
                             .toUtf8()
                             .constData()),
                ORIGIN));
    };
    const auto normal = make("normal");
    ASSERT_NE(normal, nullptr);
    EXPECT_TRUE(normal->animated());
    EXPECT_NEAR(normal->phaseAt(1000), 0.25, 1e-9);
    EXPECT_NEAR(normal->phaseAt(4000 + 2000), 0.5, 1e-9);

    EXPECT_NEAR(make("reverse")->phaseAt(1000), 0.75, 1e-9);
    // Alternate plays forward, then back, over two cycles.
    const auto alternate = make("alternate");
    EXPECT_NEAR(alternate->phaseAt(2000), 0.5, 1e-9);
    EXPECT_NEAR(alternate->phaseAt(6000), 0.5, 1e-9);
    EXPECT_NEAR(alternate->phaseAt(7000), 0.25, 1e-9);

    // GIF animation off in settings stops Flare motion too.
    getSettings()->animateEmotes = false;
    EXPECT_FALSE(normal->animated());
    getSettings()->animateEmotes = true;
}

TEST_F(NameflarePaintsTest, RecipesThatCannotBeDrawnAreIgnored)
{
    EXPECT_EQ(NameflarePaints::paintFromCosmetic(QJsonObject{}, ORIGIN), nullptr);
    EXPECT_EQ(NameflarePaints::paintFromCosmetic(
                  cosmetic(R"({"colors":["not-a-colour"],"animation":"none"})"),
                  ORIGIN),
              nullptr);
}
