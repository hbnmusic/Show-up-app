# Play Console: content rating questionnaire (draft answers)

Play Console → App content → Content rating → IARC questionnaire. Answer for the app as shipped. Category names in the form can
change; pick the closest match [inference].

| Question area | Answer | Why |
| --- | --- | --- |
| App category | The closest of "Social / communication" or "All other app types". Choose "Social / communication" if you want the conservative answer, because people can submit content that others see. | Pull Up is a listings app with limited user-submitted shows. |
| Violence (any kind, including cartoon or fantasy) | No | None in the app. |
| Blood or gore | No | |
| Sexual content or nudity | No | The app contains none. Flyer images come from providers and are not reviewed by us (see note). |
| Profanity or crude humor | No in the app's own content. User text can contain anything; answer the user-content question as Yes. | |
| Controlled substances (drugs, alcohol, tobacco) | No depiction or promotion. Some shows are at bars or 21+ venues; the app shows no age gate and no drinks content. | If the form asks about references, answer "No". Reconsider if you add venue photos. |
| Gambling or simulated gambling | No | |
| Fear or horror themes | No | |
| Can users interact with each other? | Limited: users cannot message each other. They can add shows and confirm or report shows. | |
| Is user-generated content shared? | Yes: shows people submit are visible to other users, with reporting, blocking and moderation. | |
| Does the app share the user's location with other users? | No | Location stays on the phone. |
| Does the app allow users to purchase digital goods or make purchases? | No | Ticket links open the provider's web page. |
| Does the app contain unrestricted web access? | No | Links open the system browser; there is no in-app browser. |
| Does the app have ads? | No | |

Expected result: a rating around "Everyone 10+" or "Teen" because of user-generated content and music-event context [inference]. The
questionnaire sets the actual rating; do not change answers to get a lower one.

Notes:
- Flyer and event images are loaded from JamBase, Ticketmaster and Deezer. We do not review them. If any image is inappropriate, it comes
  from the provider; you cannot remove it, but you can hide the show via `supabase/MODERATION.md` if it is a community show.
- **Target audience** (Play Console → App content → Target audience): the app's minimum age is 18 (Terms, Privacy Policy and in-app text).
  Select only the **16–17** and **18 and over** groups. Do not select any group under 16, which avoids the extra requirements for
  apps that appeal to children. Note the Play age groups are 13–15, 16–17 and 18+ [inference], so 18+ maps to the last one (18 and over only).
