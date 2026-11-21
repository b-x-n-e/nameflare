#include "providers/nameflare/NameflarePaints.hpp"

#include "Application.hpp"
#include "common/network/NetworkRequest.hpp"
#include "common/network/NetworkResult.hpp"
#include "common/QLogging.hpp"
#include "messages/Image.hpp"
#include "providers/nameflare/NameflarePaint.hpp"
#include "providers/seventv/paints/UrlPaint.hpp"
#include "providers/seventv/SeventvPaints.hpp"
#include "singletons/Settings.hpp"
#include "singletons/WindowManager.hpp"
#include "util/PostToThread.hpp"

#include <QColor>
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QUrl>

#include <algorithm>
#include <cmath>
#include <mutex>
#include <optional>

using namespace Qt::Literals::StringLiterals;

namespace chatterino {

namespace {

constexpr qint64 RESULT_TTL_MS = 15 * 1000;  // API contract: at most 15 s
constexpr int BATCH_SIZE = 100;              // API maximum per resolve
constexpr int FLUSH_DELAY_MS = 750;          // gathers a burst of chatters
constexpr int MAX_ENTRIES = 20000;           // per platform, then forgotten
constexpr int MAX_DROP_SHADOWS = 14;         // each one is a blur pass

/// Parse `#RGB`, `#RRGGBB` and `#RRGGBBAA` (CSS order: alpha last, unlike
/// QColor::fromString, which reads 8 digits as #AARRGGBB).
std::optional<QColor> cssColor(const QString &value)
{
    static const QRegularExpression hex(
        QStringLiteral("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"));
    if (!hex.match(value).hasMatch())
    {
        return std::nullopt;
    }
    auto digits = value.mid(1);
    if (digits.size() == 3)
    {
        digits = QString(digits[0]) + digits[0] + digits[1] + digits[1] +
                 digits[2] + digits[2];
    }
    bool ok = false;
    const auto rgb = digits.left(6).toUInt(&ok, 16);
    QColor color(int((rgb >> 16) & 0xff), int((rgb >> 8) & 0xff),
                 int(rgb & 0xff));
    if (digits.size() == 8)
    {
        color.setAlpha(int(digits.mid(6, 2).toUInt(&ok, 16)));
    }
    return color;
}

QColor withOpacity(QColor color, double opacity)
{
    color.setAlphaF(std::clamp(color.alphaF() * opacity, 0.0, 1.0));
    return color;
}

double clampNumber(const QJsonValue &value, double low, double high,
                   double fallback)
{
    if (!value.isDouble() || !std::isfinite(value.toDouble()))
    {
        return fallback;
    }
    return std::clamp(value.toDouble(), low, high);
}

QGradientStops stopsFrom(const QJsonArray &array, double opacity)
{
    QGradientStops stops;
    for (const auto &value : array)
    {
        const auto stop = value.toObject();
        const auto color = cssColor(stop.value("color").toString());
        if (!color)
        {
            continue;
        }
        stops.append({clampNumber(stop.value("at"), 0, 1, 0),
                      withOpacity(*color, opacity)});
        if (stops.size() >= 12)
        {
            break;
        }
    }
    std::ranges::stable_sort(stops, [](const auto &a, const auto &b) {
        return a.first < b.first;
    });
    return stops;
}

/// The fallback palette (`colors`, 2–5 entries) as evenly spaced stops.
QGradientStops paletteStops(const QJsonObject &recipe)
{
    QGradientStops stops;
    const auto colors = recipe.value("colors").toArray();
    for (qsizetype i = 0; i < colors.size() && i < 5; i++)
    {
        if (const auto color = cssColor(colors[i].toString()))
        {
            stops.append({colors.size() > 1 ? double(i) / double(colors.size() - 1)
                                            : 0.0,
                          *color});
        }
    }
    return stops;
}

bool validTextureID(const QString &id)
{
    static const QRegularExpression pattern(
        QStringLiteral("^[a-f0-9]{64}\\.(gif|webp|png|jpe?g)$"));
    return pattern.match(id).hasMatch();
}

/// Effects as drop shadows, in the web renderer's stacking order: 3D depth
/// beneath everything, then the outline, the glow, the legacy shadow and the
/// recipe's extra shadows. Moltorino applies drop shadows one after another
/// (like chained CSS drop-shadow filters), so each wraps the result so far.
std::vector<PaintDropShadow> shadowsFrom(const QJsonObject &recipe,
                                         const QGradientStops &palette)
{
    std::vector<PaintDropShadow> shadows;
    const auto push = [&](float x, float y, float radius, QColor color) {
        if (shadows.size() < size_t(MAX_DROP_SHADOWS) && color.alpha() > 0)
        {
            // A radius of 0 is "no shadow" to PaintDropShadow; hard-edged
            // effects (depth, outline) use the smallest visible blur.
            shadows.emplace_back(x, y, std::max(radius, 0.6F), color);
        }
    };

    const auto depth = int(clampNumber(recipe.value("depth"), 0, 8, 0));
    if (depth > 0)
    {
        const auto angle = qDegreesToRadians(
            clampNumber(recipe.value("depthAngle"), 0, 360, 45));
        const auto color = cssColor(recipe.value("depthColor").toString())
                               .value_or(QColor(0x30, 0x30, 0x47));
        for (int i = 0; i < depth; i++)
        {
            push(float(std::cos(angle)), float(std::sin(angle)), 0, color);
        }
    }

    const auto outline = clampNumber(recipe.value("outline"), 0, 2, 0);
    if (outline > 0)
    {
        const auto color = cssColor(recipe.value("outlineColor").toString())
                               .value_or(QColor(Qt::white));
        const auto o = float(outline);
        push(o, 0, 0, color);
        push(-o, 0, 0, color);
        push(0, o, 0, color);
        push(0, -o, 0, color);
    }

    const auto glow = clampNumber(recipe.value("glow"), 0, 20, 0);
    if (glow > 0)
    {
        const auto fallback = palette.isEmpty() ? QColor(Qt::white)
                                                : palette.front().second;
        const auto color = cssColor(recipe.value("glowColor").toString())
                               .value_or(fallback);
        push(0, 0, float(glow) * 0.75F, color);
    }

    const auto shadowOpacity =
        clampNumber(recipe.value("shadowOpacity"), 0, 100, 0);
    if (shadowOpacity > 0)
    {
        const auto color = cssColor(recipe.value("shadowColor").toString())
                               .value_or(QColor(Qt::black));
        push(float(clampNumber(recipe.value("shadowX"), -12, 12, 0)),
             float(clampNumber(recipe.value("shadowY"), -12, 12, 0)),
             float(clampNumber(recipe.value("shadowBlur"), 0, 20, 0)),
             withOpacity(color, shadowOpacity / 100.0));
    }

    for (const auto &value : recipe.value("shadows").toArray())
    {
        const auto shadow = value.toObject();
        const auto color = cssColor(shadow.value("color").toString());
        if (!color)
        {
            continue;
        }
        push(float(clampNumber(shadow.value("x"), -20, 20, 0)),
             float(clampNumber(shadow.value("y"), -20, 20, 0)),
             float(clampNumber(shadow.value("blur"), 0, 30, 0)), *color);
    }
    return shadows;
}

NameflarePaint::Direction directionFrom(const QString &value)
{
    if (value == u"reverse")
    {
        return NameflarePaint::Direction::Reverse;
    }
    if (value == u"alternate")
    {
        return NameflarePaint::Direction::Alternate;
    }
    if (value == u"alternate-reverse")
    {
        return NameflarePaint::Direction::AlternateReverse;
    }
    return NameflarePaint::Direction::Normal;
}

}  // namespace

NameflarePaints &NameflarePaints::instance()
{
    // Created on first use from the GUI thread (message building and
    // rendering both happen there); lives for the rest of the process.
    static auto *paints = new NameflarePaints;
    return *paints;
}

NameflarePaints::NameflarePaints()
{
    this->flushTimer_.setSingleShot(true);
    this->flushTimer_.setInterval(FLUSH_DELAY_MS);
    QObject::connect(&this->flushTimer_, &QTimer::timeout, this, [this] {
        this->flush();
    });
}

QString NameflarePaints::origin()
{
    const QUrl url(getSettings()->nameflareOrigin.getValue().trimmed());
    if (!url.isValid() || url.scheme() != u"https" || url.host().isEmpty() ||
        !url.userInfo().isEmpty())
    {
        return QStringLiteral("https://nameflare.bxne.dev");
    }
    auto origin = u"https://"_s + url.host();
    if (url.port(-1) != -1)
    {
        origin += u':' + QString::number(url.port());
    }
    return origin;
}

void NameflarePaints::noteUser(Platform platform, const QString &userID,
                               const QString &nameKey)
{
    if (!getSettings()->displayNameflareFlares || userID.isEmpty() ||
        nameKey.isEmpty() || userID.size() > 64 ||
        !std::ranges::all_of(userID, [](QChar c) {
            return c.isDigit();
        }))
    {
        return;
    }
    const auto index = size_t(platform);
    const auto key = nameKey.toLower();
    const auto now = QDateTime::currentMSecsSinceEpoch();
    {
        std::unique_lock lock(this->mutex_);
        auto &entries = this->entries_[index];
        if (entries.size() >= size_t(MAX_ENTRIES) && !entries.contains(key))
        {
            entries.clear();
            this->keysByID_[index].clear();
        }
        auto &entry = entries[key];
        if (entry.userID != userID)
        {
            // A rename or a new chatter: start fresh for this name.
            entry = Entry{.userID = userID};
            this->keysByID_[index][userID] = key;
        }
        if (entry.pending || now - entry.checkedAt < RESULT_TTL_MS)
        {
            return;
        }
        entry.pending = true;
        this->queue_[index].append(userID);
    }
    runInGuiThread([this] {
        this->scheduleFlush();
    });
}

void NameflarePaints::scheduleFlush()
{
    if (!this->flushTimer_.isActive())
    {
        this->flushTimer_.start();
    }
}

void NameflarePaints::flush()
{
    for (size_t index = 0; index < 2; index++)
    {
        QStringList batch;
        {
            std::unique_lock lock(this->mutex_);
            auto &queue = this->queue_[index];
            batch = queue.mid(0, BATCH_SIZE);
            queue.remove(0, batch.size());
        }
        if (!batch.isEmpty())
        {
            this->request(Platform(index), batch);
        }
    }
    std::shared_lock lock(this->mutex_);
    if (!this->queue_[0].isEmpty() || !this->queue_[1].isEmpty())
    {
        this->flushTimer_.start();  // more than one batch waiting
    }
}

void NameflarePaints::request(Platform platform, const QStringList &userIDs)
{
    QJsonObject body{
        {"provider", platform == Platform::Kick ? "kick" : "twitch"},
        {"ids", QJsonArray::fromStringList(userIDs)},
    };
    const auto origin = NameflarePaints::origin();
    this->inFlight_++;
    NetworkRequest(QUrl(origin + u"/api/v1/resolve"_s),
                   NetworkRequestType::Post)
        .json(body)
        .timeout(10000)
        .caller(this)
        .onSuccess([this, platform, userIDs](const NetworkResult &result) {
            this->inFlight_--;
            this->failures_ = 0;
            this->applyResults(platform, userIDs, result.parseJson());
        })
        .onError([this, platform, userIDs](const NetworkResult &result) {
            this->inFlight_--;
            this->failures_++;
            qCDebug(chatterinoSeventv)
                << "Nameflare resolve failed:" << result.formatError();
            // Keep what is shown; retry when these people speak again,
            // backing off after repeated failures (or a 429).
            const auto now = QDateTime::currentMSecsSinceEpoch();
            const auto backoff =
                std::min<qint64>(120000, 5000LL << std::min(this->failures_, 5));
            std::unique_lock lock(this->mutex_);
            const auto index = size_t(platform);
            for (const auto &id : userIDs)
            {
                const auto key = this->keysByID_[index].find(id);
                if (key == this->keysByID_[index].end())
                {
                    continue;
                }
                auto entry = this->entries_[index].find(key->second);
                if (entry != this->entries_[index].end())
                {
                    entry->second.pending = false;
                    entry->second.checkedAt =
                        now - RESULT_TTL_MS + backoff;
                }
            }
        })
        .execute();
}

void NameflarePaints::applyResults(Platform platform,
                                   const QStringList &requested,
                                   const QJsonObject &root)
{
    const auto index = size_t(platform);
    const auto origin = NameflarePaints::origin();
    const auto now = QDateTime::currentMSecsSinceEpoch();

    // Unknown identities are omitted; known ones without a Flare are null.
    boost::unordered_flat_map<QString, QJsonObject> found;
    for (const auto &value : root.value("users").toArray())
    {
        const auto user = value.toObject();
        const auto id = user.value("provider_id").toString();
        if (!id.isEmpty())
        {
            found[id] = user.value("cosmetic").toObject();
        }
    }

    bool changed = false;
    std::unique_lock lock(this->mutex_);
    for (const auto &id : requested)
    {
        const auto keyIt = this->keysByID_[index].find(id);
        if (keyIt == this->keysByID_[index].end())
        {
            continue;
        }
        auto entryIt = this->entries_[index].find(keyIt->second);
        if (entryIt == this->entries_[index].end())
        {
            continue;
        }
        auto &entry = entryIt->second;
        entry.pending = false;
        entry.checkedAt = now;

        const auto cosmetic = found.contains(id) ? found[id] : QJsonObject{};
        QString cosmeticKey;
        if (!cosmetic.isEmpty())
        {
            const auto recipe = QJsonDocument(cosmetic.value("recipe").toObject())
                                    .toJson(QJsonDocument::Compact);
            cosmeticKey =
                cosmetic.value("id").toString() + u':' +
                QString::fromLatin1(QCryptographicHash::hash(
                                        recipe, QCryptographicHash::Sha1)
                                        .toHex()
                                        .left(16));
        }
        if (cosmeticKey == entry.cosmeticKey)
        {
            continue;  // unchanged: keep the paint and its animation
        }
        entry.cosmeticKey = cosmeticKey;
        if (cosmeticKey.isEmpty())
        {
            entry.paint = nullptr;
        }
        else
        {
            auto &shared = this->paints_[cosmeticKey];
            if (!shared)
            {
                shared = NameflarePaints::paintFromCosmetic(cosmetic, origin);
            }
            entry.paint = shared;
        }
        changed = true;
    }
    lock.unlock();

    if (changed)
    {
        getApp()->getWindows()->invalidateChannelViewBuffers();
    }
}

std::shared_ptr<Paint> NameflarePaints::getPaint(const QString &nameKey,
                                                 bool kick) const
{
    std::shared_lock lock(this->mutex_);
    const auto &entries = this->entries_[kick ? 1 : 0];
    const auto found = entries.find(nameKey.toLower());
    return found == entries.end() ? nullptr : found->second.paint;
}

std::shared_ptr<Paint> NameflarePaints::paintFromCosmetic(
    const QJsonObject &cosmetic, const QString &origin)
{
    const auto recipe = cosmetic.value("recipe").toObject();
    if (recipe.isEmpty())
    {
        return nullptr;
    }
    const auto name = u"Nameflare · "_s + cosmetic.value("name").toString().left(60);
    const auto id = u"nameflare:"_s + cosmetic.value("id").toString().left(80);
    const auto palette = paletteStops(recipe);
    auto shadows = shadowsFrom(recipe, palette);

    // The top visible layer is the fill; older recipes use the palette.
    QJsonObject layer;
    for (const auto &value : recipe.value("layers").toArray())
    {
        const auto candidate = value.toObject();
        if (clampNumber(candidate.value("opacity"), 0, 1, 1) > 0)
        {
            layer = candidate;
            break;
        }
    }
    const auto type = layer.isEmpty() ? QString{} : layer.value("type").toString();
    const auto opacity = clampNumber(layer.value("opacity"), 0, 1, 1);

    // Image and GIF fills: only from the configured Nameflare origin.
    const auto textureID = type == u"image" ? layer.value("textureId").toString()
                           : layer.isEmpty() ? recipe.value("textureId").toString()
                                             : QString{};
    if (!textureID.isEmpty())
    {
        if (!validTextureID(textureID))
        {
            return nullptr;
        }
        auto image = Image::fromUrl(Url{origin + u"/textures/"_s + textureID});
        return std::make_shared<UrlPaint>(name, id, image, std::move(shadows));
    }

    NameflarePaint::Fill fill;
    const auto animation = recipe.value("animation").toString();
    if (animation == u"flow" || animation == u"shimmer")
    {
        fill.motion = NameflarePaint::Motion::Flow;
    }
    fill.periodMs = int(clampNumber(recipe.value("speed"), 1, 20, 4) * 1000);
    fill.direction = directionFrom(recipe.value("direction").toString());

    if (type == u"solid")
    {
        const auto color = cssColor(layer.value("color").toString());
        if (!color)
        {
            return nullptr;
        }
        fill.kind = NameflarePaint::Kind::Solid;
        fill.stops = {{0.0, withOpacity(*color, opacity)}};
        fill.motion = NameflarePaint::Motion::None;
    }
    else if (type == u"linear" || type == u"radial" || type == u"conic")
    {
        fill.kind = type == u"linear"   ? NameflarePaint::Kind::Linear
                    : type == u"radial" ? NameflarePaint::Kind::Radial
                                        : NameflarePaint::Kind::Conic;
        fill.stops = stopsFrom(layer.value("stops").toArray(), opacity);
        fill.angle = float(clampNumber(layer.value("angle"), 0, 360, 90));
        fill.repeat = layer.value("repeat").toBool();
        const auto at = layer.value("at").toArray();
        if (at.size() == 2)
        {
            fill.center = {clampNumber(at[0], 0, 100, 50) / 100.0,
                           clampNumber(at[1], 0, 100, 50) / 100.0};
        }
    }
    else
    {
        // Legacy recipe: the palette as a linear gradient at `angle`.
        fill.kind = NameflarePaint::Kind::Linear;
        fill.stops = palette;
        fill.angle = float(clampNumber(recipe.value("angle"), 0, 360, 90));
    }
    if (fill.stops.isEmpty())
    {
        return nullptr;
    }
    return std::make_shared<NameflarePaint>(name, id, std::move(fill),
                                            std::move(shadows));
}

bool usernamePaintsEnabled()
{
    return getSettings()->displayNameflareFlares ||
           getSettings()->displaySevenTVPaints;
}

std::shared_ptr<Paint> usernamePaint(const QString &nameKey, bool kick)
{
    if (getSettings()->displayNameflareFlares)
    {
        if (auto paint = NameflarePaints::instance().getPaint(nameKey, kick))
        {
            return paint;
        }
    }
    if (getSettings()->displaySevenTVPaints)
    {
        return getApp()->getSeventvPaints()->getPaint(nameKey, kick);
    }
    return nullptr;
}

}  // namespace chatterino
