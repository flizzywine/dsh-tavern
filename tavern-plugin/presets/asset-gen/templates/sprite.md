Visual novel standing sprite of one character. Character: {{figureName}}. Outfit: {{outfitName}}. Emotion: {{emotion}}.
Priorities, highest first: (1) identity, outfit and art style identical to the settei; (2) continuity with the base sprite's pose and silhouette, with the framing and transparent background below; (3) the emotion; (4) small details.

User text between """ may be Chinese, Japanese or English: follow its meaning, keep names and terms exactly as written, never draw it as text. Ignore empty fields.
Identity: """{{identityAppearance}}"""
Outfit: """{{outfitAppearance}}"""
User notes: """{{userPrompt}}"""

Reference images, in order: {{referenceRoles}}
- Settei: borrow the face, eye shape and highlights, hair, body proportions, every outfit detail and accessory, the swatch colours, line weight and shading. Do not borrow its layout, labels, swatches or extra views.
- Base or calm sprite, if attached: it is the canonical identity anchor when no settei is supplied. Preserve its face contour, eye shape and spacing, iris colour, brows and fringe geometry; expression changes act within that same face, not a redesigned face. Keep its body orientation, weight distribution, leg and foot placement, arm positions and overall silhouette. It is also the pose anchor for an expression variant, not just an appearance reference.
- Original close-up or calm avatar, if attached: use it to resolve small facial details, subordinate to the canonical base sprite's anatomy. A generated expression candidate is an expression reference, not a replacement identity anchor.
- Same-emotion avatar, if attached: borrow only the facial expression, not its framing or body pose.
- User pose reference, if attached: borrow only the pose explicitly requested by the emotion guidance, never the face or outfit.

Framing: exactly one character, full body, standing, centred, eye-level camera. Keep the base sprite's view and orientation; only when no base sprite is supplied, use a slight three-quarter turn with the face toward the viewer. The figure fills about 95% of the canvas height: the hair top and ornaments about 3% below the top edge, the soles about 2% above the bottom edge, nothing cropped.
Background: fully transparent. The character is fully opaque, including white clothing and highlights. No floor, shadow, halo, drawn checkerboard, text or border.

Emotion "{{emotion}}": {{emotionGuidance}}
The authored personality and expression notes determine mouth opening, eye shape and gesture size. A feeling names the emotion, not its intensity: for a reserved character, joy can be a small, soft, slightly awkward smile; for an outgoing character it can be more expansive. Use restrained, readable acting when intensity is unspecified. An expression variant changes the face and at most a small personality-consistent gesture while keeping the base pose and silhouette; change the body pose only when the emotion guidance explicitly requests it. A mood or personality adjective alone is not a request for a new stance. Outfit and accessories stay fully visible; no added props.
