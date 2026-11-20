# Privacy

What a Nameflare server stores about people, why, for how long, and how to
get it or delete it. The same summary is in the app under Guide → Privacy &
your data. Operators running their own server should publish their own contact
details next to this.

## What is stored

| Data | Why | Visible to |
|---|---|---|
| Account: display name, avatar, bio, profile colour, join date | Your profile | Everyone |
| Connected platform accounts: platform user ID, login, display name, avatar | Signing in, and showing your Flare in chat | Everyone (this is how chat tools find your Flare) |
| Flares you made, with their recipes and images | The product itself | Approved ones: everyone. Pending or disapproved: you and moderators |
| Likes, follows | Your feed and creators' counts | Counts are public; who liked or followed is private |
| Notifications | Your inbox | You |
| Reports you send | Moderation | Moderators |
| Staff notes about an account | Moderation context (warnings, follow-ups) | Moderators and the owner. Deleted with the account |
| Sign-in session | Keeping you signed in | Nobody (stored as a hash; the cookie expires after 7 days) |
| Networks you sign in or make changes from | Making bans stick: a ban also blocks the networks the banned account used | Nobody. Stored only as a keyed hash of the network (an IPv6 /64 counts as one), never the address, for 90 days |
| Page views | Insights for creators and the operator | Daily counts per page only: no address, account or device. Off when Do Not Track or Global Privacy Control is on |

Not stored: passwords (there are none), platform access or refresh tokens,
email addresses, IP addresses in readable form (rate limits use them in memory;
bans use the keyed hashes above), or access logs of the URLs people visit.

## Uploaded images

Images are decoded and rebuilt before storage, which removes location and camera
metadata, comments and anything appended to the file. The operator may also scan
uploads for malware and unsafe content (see [Operations](OPERATIONS.md#uploaded-images)).

## How long it is kept

| Record | Kept for |
|---|---|
| Notifications | 180 days |
| Network hashes | 90 days after last use; network bans 90 days |
| Page-view counts | 400 days |
| Images no Flare uses | 7 days after upload |
| Disapproved Flares | 1 year after the decision |
| Report details | 90 days after the report is closed; the report itself 1 year |
| Moderation activity log | 2 years |
| Backups | 14 days |
| Everything else | Until you delete it or your account |

## Your choices

- **See what is stored:** Account → Your data → **Download my data** returns all of the above as JSON.
- **Delete your account:** Account → Your data → **Delete my account**. Everything listed above that belongs to you is removed at once. Two things remain: reports you sent (with your name removed, because others may need them) and a moderation log line that an account was deleted. Backups roll off within 14 days.
- **Report something:** use Report on a Flare or a profile. The person reported is not told who reported them.

If an account was banned and then erased, Nameflare keeps a one-way hash of its
platform identities so that the ban still applies to them. Nothing else about
the account remains.
