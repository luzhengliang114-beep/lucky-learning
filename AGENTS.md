# Lucky Learning Rules

Project display name: 鹿lucky Learning. Repository name: lucky-learning.

1. Keep customer code, data, credentials, media, and deployment environments isolated.
2. Never commit `.env`, `cloudbaserc.json`, secrets, employee lists, store lists, production records, or customer media.
3. Brand names, logos, colors, and customer-facing copy must come from validated brand configuration.
4. The employee app must open on Home by default.
5. Preserve the learning rules: videos cannot be fast-forwarded, PPT slides require at least three seconds, and failed exams require relearning the configured video/PPT units.
6. A disabled optional module must not block learning or exams.
7. Run focused tests, type checks, both frontend builds, and isolation checks before claiming completion.
8. Deployment and public GitHub publishing require explicit user confirmation.

## Brand Onboarding

- First ask in the conversation: "请把企业 Logo 或品牌色卡发给我，我会配置到员工端和管理后台，再打开真实页面给你确认。"
- Accept either a logo or a palette; both are optional together. Ask for a company name only when necessary. Never assume that a logo visible inside a screenshot is the original brand asset.
- When only a logo is supplied, derive a suitable primary color and use neutral surfaces. When only colors are supplied, retain the default logo until an asset is supplied.
- Update config/brand.json and brand/ directly. Keep business features and layout unchanged unless requested.
- Validate contrast and brand assets, run the required checks, and show the real employee and admin pages on desktop and mobile.
- Do not add a color picker wizard, imitation preview cards, or a configuration export step.
