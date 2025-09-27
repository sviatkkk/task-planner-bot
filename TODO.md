# TODO for Adding Custom Time Input Support

## Current Work
Adding support for custom time inputs in timer selection, allowing users to enter times like "16:45" for daily reminders or "через 30 хвилин" for interval reminders, in addition to numbered options.

## Key Technical Concepts
- parseCustomTime function to parse HH:MM or "через X хвилин/годин" inputs.
- Updated waitingForTimer and waitingForTaskTimer handlers to handle custom inputs.
- Daily schedules stored with type 'daily_hour' and hour/minute.
- Interval schedules use existing ms-based logic.
- check-reminders.js updated to compute next daily occurrences.

## Relevant Files and Code
- bot.js
  - Added parseCustomTime function.
  - Updated waitingForTaskTimer handler to parse custom time and set daily or interval reminders.
  - Updated waitingForTimer handler similarly for global timers.
- api/check-reminders.js
  - Added logic to update nextGlobalReminder based on schedule.type === 'daily_hour'.
  - Added logic for task reminders to update nextReminder based on reminderSchedule.type === 'daily_hour'.

## Problem Solving
- Ensured custom inputs are parsed correctly and fallback to invalid message if not recognized.
- Maintained existing numbered option logic.
- Daily reminders compute next occurrence correctly, skipping to next day if time has passed.
- No conflicts with existing interval-based reminders.

## Pending Tasks and Next Steps
- [x] Step 1: Update waitingForTaskTimer handler to support custom time inputs.
- [x] Step 2: Update waitingForTimer handler to support custom time inputs.
- [x] Step 3: Update check-reminders.js to handle daily schedules for global and task reminders.
- [ ] Step 4: Test the custom time input feature by entering various formats and verifying reminders trigger at correct times.
- [ ] Step 5: Update this TODO.md to reflect completion.
