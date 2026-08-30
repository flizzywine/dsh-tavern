# Current character-card settings

Some character cards are designed to work alongside other frameworks or include a custom front end.
They therefore require a predefined set of MVU settings so that workflows such as extra-model
parsing use the intended update method and world-book entries.

Any non-regex setting explicitly configured here overrides the corresponding user setting; settings
set to **Inherit user settings** do not. The character card's world-book entry whitelist and
blacklist regexes are combined with the rules in the user settings: an entry passes the whitelist if
it matches any configured whitelist rule, and is excluded if it matches any configured blacklist
rule.

For example, if **Automatic requests** is set to **Disabled** in the character-card settings, MVU
will not start extra-model parsing automatically after an AI reply is received, regardless of the
user's setting for this option. You can still run it manually with **Retry extra-model parsing**.

The whitelist and blacklist affect world-book entries only in extra-model parsing requests. For
blacklist regexes, an entry subject to filtering is excluded when its `comment` matches either the
user's rule or the character card's rule. Entries marked `[mvu_update]` bypass whitelist and
blacklist filtering.
