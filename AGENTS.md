# AGENTS.md — Salon Queue Management System

## Project Overview
Build a Salon Queue Management System that helps customers join and track a salon queue while allowing receptionists, barbers and owners to manage salon operations.

The application must follow the requirements in the three documents inside the `docs` folder.

## Required Documents
Before implementing any feature, read these documents:

1. `docs/01-brief.md` — Project problem, target users, features and design.
2. `docs/02-screens.md` — Screen layouts, elements and button behaviour.
3. `docs/03-flows-rules.md` — Customer workflows, queue rules and testing checklist.

These documents are the main source of project requirements.

## Technology and Setup
- Use React with Vite.
- Use Tailwind CSS for styling.
- Choose the simplest reliable storage approach that supports synchronization between customer, receptionist, barber and TV screens.
- Explain the proposed storage and synchronization approach before implementing it.
- Keep the application responsive for mobile, tablet and desktop screens.
- Provide clear setup and run instructions.

## Design Guidelines
- Use a premium, modern salon design.
- Main background: charcoal (#1F2937).
- Accent colour: gold (#D4A017).
- Use rounded cards, clean layouts and readable typography.
- Support English and Gujarati interface labels.
- Make buttons and interactive elements easy to use on touchscreens.

## Working Rules
1. Read all project documents before starting development.
2. Do not ignore or change the specified requirements without discussing the change first.
3. Do not build all features in one step.
4. Work in small stages and explain what will be implemented before making changes.
5. After each stage, run the application and check the result.
6. Test the application against the checklist in `docs/03-flows-rules.md`.
7. Keep the code organized and easy to understand.
8. Do not add unrelated features outside the project scope.
9. Ask before making major technology or architecture changes.

## Development Order
Build the application in this order:

1. Project setup, theme and empty layouts for all seven screens.
2. Home screen and Join Queue.
3. My Status screen and token generation.
4. Reception Dashboard.
5. Barber View and Waiting Area TV Display.
6. Owner Settings.
7. Queue rules, validation, synchronization, testing and final polish.

## Important
Do not start implementing the application until the project documents have been read and the initial implementation plan has been presented for review.