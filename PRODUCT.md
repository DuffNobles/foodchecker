# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person: an adult with type 2 diabetes who does not use insulin and wants a better A1C through food choices. Mainly on an iPhone (added to the Home Screen), sometimes an iPad. Uses it at the table or while choosing from a restaurant menu, one-handed, in a few seconds. Her husband builds and tests it.

## Product Purpose
Photograph a meal or a written menu and see total carbohydrates, total sugars, calories and protein for the portion, with a rule-based Blood-sugar check. Correct a food or a portion, add a food, save results as references. A helpful estimate, never a medical instruction. Success: a real meal photographed, corrected and saved in under a minute without help.

## Positioning
Detection and portion come from the AI; the numbers come from USDA FoodData Central wherever a match exists, and every value says where it came from (USDA, the model's estimate, her own value, or "Not available").

## Operating Context
Private app behind an access code typed once per device. No login, no sync, no database: results live on the device. Menus are often Spanish; the interface is English only and keeps dish names as printed with a short English translation.

## Capabilities and Constraints
- Screens: home, scan a meal (result with "What I see", four value cards, fiber block, confidence, Blood-sugar check, portion control), correct a food, add a food, saved list and saved result, scan a menu (dish cards, sort).
- Blood-sugar check: carbs in the portion vs. a per-meal limit (default 45 g, editable), four steps: Best Choice, Good Option, Not Recommended, Avoid. Sugars over 25 g make it one step stricter.
- Won't have in v1: A1C tracking, insulin dosing, accounts, profiles.

## Brand Commitments
- Safety wording stays visible and unchanged: the "does not replace your care team" note, "Source: USDA FoodData Central", the source label on every value, the "AI estimates" line on the scale, the scale's step names.
- Calm words, no shaming, no alarming red by default. No dosing, diagnosis or medication advice.
- Plain language, no developer jargon.

## Evidence on Hand
Sample meal and menu photos in `risk-test/images/`. Use sample meals for reviews and tests, never her real history.

## Product Principles
1. Every number shows its source and portion, or says "Not available".
2. Calm and trustworthy over clever.
3. Fast one-handed use on a phone comes first.
4. Correcting the AI is easy and expected.

## Accessibility & Inclusion
Adult user reading on a phone, often in restaurant light: readable text sizes, strong contrast, 44 px touch targets.
