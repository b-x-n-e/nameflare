#pragma once

#include "util/QStringHash.hpp"  // IWYU pragma: keep

#include <boost/unordered/unordered_flat_map.hpp>
#include <QJsonObject>
#include <QObject>
#include <QString>
#include <QStringList>
#include <QTimer>

#include <array>
#include <memory>
#include <shared_mutex>

namespace chatterino {

class Paint;

/// Nameflare Flares as username paints (https://nameflare.bxne.dev).
///
/// Message builders report each chatter with `noteUser` (platform user ID plus
/// the key the nametag is drawn with). IDs are looked up in batches of up to
/// 100 through the public `POST /api/v1/resolve` endpoint, cached for 15
/// seconds as the API contract requires, and re-checked when the person
/// speaks again after that. `usernamePaint` is what the renderer asks: a
/// Nameflare paint when the person wears an approved Flare, otherwise their
/// 7TV paint.
class NameflarePaints final : public QObject
{
public:
    enum class Platform : std::uint8_t {
        Twitch = 0,
        Kick = 1,
    };

    static NameflarePaints &instance();

    /// `userID` is the immutable platform ID; `nameKey` is the login (Twitch)
    /// or display name (Kick) the nametag links to. Thread-safe.
    void noteUser(Platform platform, const QString &userID,
                  const QString &nameKey);

    std::shared_ptr<Paint> getPaint(const QString &nameKey, bool kick) const;

    /// Build a paint from a public cosmetic object (`{id, name, recipe}`).
    /// Returns nullptr for anything that cannot be drawn safely.
    static std::shared_ptr<Paint> paintFromCosmetic(const QJsonObject &cosmetic,
                                                    const QString &origin);

    /// The configured service origin, normalised (https only, no path).
    static QString origin();

private:
    NameflarePaints();

    struct Entry {
        QString userID;
        QString cosmeticKey;  // cosmetic id + recipe hash, or empty
        std::shared_ptr<Paint> paint;
        qint64 checkedAt = 0;
        bool pending = false;
    };

    void scheduleFlush();
    void flush();
    void request(Platform platform, const QStringList &userIDs);
    void applyResults(Platform platform, const QStringList &requested,
                      const QJsonObject &root);

    mutable std::shared_mutex mutex_;
    std::array<boost::unordered_flat_map<QString, Entry>, 2> entries_;  // by name key
    std::array<boost::unordered_flat_map<QString, QString>, 2> keysByID_;
    std::array<QStringList, 2> queue_;  // user IDs awaiting lookup
    boost::unordered_flat_map<QString, std::shared_ptr<Paint>> paints_;  // by cosmeticKey
    QTimer flushTimer_;
    int inFlight_ = 0;
    int failures_ = 0;
};

/// The paint the renderer draws a nametag with: a Nameflare Flare first (when
/// enabled), then the person's 7TV paint (when enabled).
std::shared_ptr<Paint> usernamePaint(const QString &nameKey, bool kick);

/// Whether nametags should be drawn with paints at all.
bool usernamePaintsEnabled();

}  // namespace chatterino
