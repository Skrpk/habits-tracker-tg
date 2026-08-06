// English dictionary — the canonical key set. Every key here MUST exist in uk.ts
// and ru.ts (enforced by the parity test). Keep {placeholders} identical across
// languages. Markdown (*bold*, _italic_, [text](url)) must be preserved by translators.
export const en: Record<string, string> = {
  // --- Onboarding: language ---
  'onboarding.language.confirmed':
    '✅ Language set to *{lang}*.\n\n' +
    "Now let's set up your timezone so reminders arrive at the right time.",

  // --- Onboarding: timezone ---
  'onboarding.timezone.prompt':
    '🌍 *Welcome to Habits Tracker!*\n\n' +
    'Look at the clock on your phone and pick the time that matches.\n\n' +
    'You can change this later in Settings.',
  'onboarding.timezone.set': '✅ Timezone set to {tz}',

  // --- Welcome ---
  'welcome':
    '✨ _Choose what is best, and habit will make it pleasant and easy._ ✨\n' +
    '— Plutarch\n\n' +
    '*Welcome to Habits Tracker! 🎯*\n\n' +
    'Commands:\n' +
    '/newhabit - Create a new habit\n\n' +
    '/myhabits - View all your habits\n\n' +
    '/analytics - View detailed analytics and graphs\n\n' +
    '/settings - Manage your settings\n\n' +
    'The bot will remind you to check your habits! ⏰\n\n',

  // --- Common ---
  'setup.required': 'Please complete setup first by sending /start',
  'common.not_set': 'Not set',

  // --- Command menu descriptions (setMyCommands) ---
  'cmd.newhabit': 'Create a new habit to track',
  'cmd.myhabits': 'View all your habits',
  'cmd.analytics': 'View your habits analytics',
  'cmd.settings': 'Manage your settings',

  // --- Reminders ---
  'reminder.ask': '⏰ Reminder: Did you "{name}" today?',
  'reminder.btn.yes': '✅ Yes',
  'reminder.btn.no': '❌ No (drop streak)',
  'reminder.btn.skip': '⏭️ Skip (keep streak)',
  'reminder.btn.later': '🕐 Check later (in 1 hour)',
  'reminder.btn.miniapp': '📱 Reply in MiniApp',
  'reminder.postponed': '🕐 Okay — I\'ll ask about "{name}" again around {time}.',
  'reminder.too_late': 'It\'s too late to postpone "{name}" today — tap ✅ / ⏭️ / ❌ when you can.',
  'reminder.already_recorded': '✅ "{name}" is already recorded for today.',
  'reminder.habit_not_found': 'Habit not found.',
  'reminder.all_checked': '✅ All habits checked for today! Great job! 🎉',
  'reminder.resumed': '▶️ Reminders resumed for "{name}". I\'ll keep nudging you.',
  'reminder.paused_notice': '😴 You haven\'t responded to "{name}" reminders lately, so I\'ve paused them for {days} days to avoid nagging. Tap Resume anytime to turn them back on.',
  'reminder.btn.resume': '▶️ Resume now',

  // --- Common ---
  'common.unable_identify': 'Unable to identify user.',
  'common.view_all': 'View all your habits with /myhabits',
  'habits.not_found': 'Habit not found',

  // --- Habits list ---
  'habits.list.empty': "You don't have any habits yet. Create one with /newhabit <name>",
  'habits.list.header': '📋 Your Habits:',
  'habits.list.footer': 'Click on a habit to view details or delete it.',
  'habits.list.streak': '🔥 Streak: {streak} days',
  'habits.list.skipped': '⏭️ Skipped: {count} days',
  'habits.list.skipped_on': '📅 Skipped on: {dates}',
  'habits.status.active': '▶️ Active',
  'habits.status.disabled': '⏸️ Disabled',

  // --- Habit details ---
  'habits.details.title': '📋 Habit Details',
  'habits.details.name': 'Name: {name}',
  'habits.details.status': 'Status: {status}',
  'habits.details.streak': '🔥 Streak: {streak} days',
  'habits.details.badges': '🏆 Badges: {badges}',
  'habits.details.skipped': '⏭️ Skipped days: {count}',
  'habits.details.reminder': '⏰ Reminder: {schedule} ({status})',
  'habits.details.last_checked': '📅 Last checked: {date}',
  'habits.details.created': '📆 Created: {date}',
  'habits.details.never': 'Never',
  'habits.reminder_on': '✅ Enabled',
  'habits.reminder_off': '❌ Disabled',
  'habits.toast.enabled': 'Habit enabled',
  'habits.toast.disabled': 'Habit disabled',
  'habits.deleted': '✅ Habit "{name}" deleted successfully!',
  'habits.delete.confirm': '⚠️ Are you sure you want to delete "{name}"?\n\nThis action cannot be undone.',

  // --- Buttons (habits / schedule) ---
  'btn.enable': '▶️ Enable Habit',
  'btn.disable': '⏸️ Disable Habit',
  'btn.set_schedule': '⏰ Set Reminder Schedule',
  'btn.delete': '🗑️ Delete Habit',
  'btn.delete_yes': '✅ Yes, delete',
  'btn.cancel': '❌ Cancel',
  'btn.back': '← Back',
  'btn.back_to_list': '← Back to List',
  'btn.sounds_good': '👍 Sounds good',
  'btn.change_time': '🕐 Change time',
  'btn.different_schedule': '📅 Different schedule',
  'btn.custom_time': '⌨️ Custom time',
  'btn.daily': '📅 Daily',
  'btn.weekly': '📆 Weekly',
  'btn.monthly': '🗓️ Monthly',
  'btn.interval': '⏱️ Interval',
  'btn.configure_miniapp': '🌐 Configure in MiniApp',

  // --- Check / skip ---
  'check.reset': 'Streak reset. You can start fresh tomorrow! 💪',
  'check.sprouted': '🌱 Your seed has sprouted! Streak for "{name}" is now 1 day!',
  'check.first_badge': '{days} more days until your first badge {emoji}',
  'check.great': 'Great! Your streak for "{name}" is now {streak} days! 🔥',
  'check.checked': 'Checked!',
  'skip.confirm': 'Are you sure you want to skip "{name}" today?\n\n⏭️ Your streak will be preserved.',
  'skip.btn.yes': '✅ Yes, skip',
  'skip.result': '⏭️ Skipped "{name}" today. Your streak of {streak} days is preserved! 💪',

  // --- New habit / schedule setup ---
  'newhabit.name_empty': '❌ Habit name cannot be empty. Please try again with /newhabit',
  'newhabit.name_is_command': '❌ Please provide a habit name, not a command. Try again with /newhabit',
  'newhabit.provide_name': 'Please provide a habit name: /newhabit <name>',
  'newhabit.created_simple': '🌱 Habit "{name}" created! Your seed is planted.\n\nView all your habits with /myhabits',
  'create.confirm': '🌱 Habit "{name}" created! Your seed is planted.\n\n⏰ We\'ll remind you *every day at {time}* ({tz}).\n\nTap *👍 Sounds good* to finish — or adjust the reminder below.',
  'create.confirm.tip': '💡 *Tip:* Starting with just one habit is the best way to build consistency. Give yourself a few days to get into the rhythm before adding more — you\'ll be surprised how much easier it is to stick with it!',
  'create.planted': '🌱 "{name}" is planted.\n\n⏰ We\'ll remind you *every day at {time}* ({tz}).\n\nTap *👍 Sounds good* to finish — or adjust the reminder below.',
  'create.ready_full': '✅ "{name}" is ready! Your seed is in the ground.\n\n⏰ {schedule}\n\nView all your habits with /myhabits',
  'create.ready_short': '✅ "{name}" is ready!\n\n⏰ {schedule}\n\nView all your habits with /myhabits',
  'schedule.not_available': 'Schedule management is not available.',
  'schedule.not_available_support': 'Schedule management is not available. Please contact support.',
  'schedule.options_expired': 'Schedule options expired. Please try again.',
  'schedule.invalid_state': 'Invalid conversation state. Please try again.',
  'schedule.unknown_type': 'Unknown schedule type.',
  'schedule.habit_or_unavailable': 'Error: Habit not found or schedule management unavailable.',
  'schedule.pick_time': '🕐 What time each day should we remind you about "{name}"?\n\nPick a time, or tap *⌨️ Custom time* to type your own (HH:MM).',
  'schedule.more': '📅 How often should we remind you about "{name}"?\n\nPick a schedule type below.',
  'schedule.dsl.completion_new': '🌱 Habit "{name}" is ready! Your seed is in the ground.\n\nSchedule: {schedule}\n\nView all your habits with /myhabits',
  'schedule.dsl.completion_update': '✅ Reminder schedule updated!\n\nHabit: {name}\nSchedule: {schedule}',
  'schedule.set': '⏰ Set Reminder Schedule for "{name}"\n\nCurrent: {current}\n\nChoose a schedule type:',
  'schedule.type.daily': '⏰ Set Daily Schedule\n\nEnter the time for daily reminders.\n\nExamples:\n• 20:30 - Every day at 8:30 PM\n• 09:00 - Every day at 9:00 AM\n\n📝 Reply with: HH:MM',
  'schedule.type.weekly': '⏰ Set Weekly Schedule\n\nEnter days and time for weekly reminders.\n\nExamples:\n• monday 18:00 - Every Monday at 6 PM\n• tuesday,saturday 20:00 - Every Tuesday and Saturday at 8 PM\n• monday,wednesday,friday 08:00 - Mon/Wed/Fri at 8 AM\n\nDays: sunday, monday, tuesday, wednesday, thursday, friday, saturday\n\n📝 Reply with: day1,day2 HH:MM',
  'schedule.type.monthly': '⏰ Set Monthly Schedule\n\nEnter day(s) of month and time for monthly reminders.\n\nExamples:\n• 15 15:42 - 15th of each month at 3:42 PM\n• 20,26 22:00 - 20th and 26th at 10 PM\n• 1,15 09:00 - 1st and 15th at 9 AM\n\n📝 Reply with: day1,day2 HH:MM',
  'schedule.type.interval': '⏰ Set Interval Schedule\n\nEnter number of days and time for interval reminders.\n\nExamples:\n• 2 15:30 - Every 2 days at 3:30 PM\n• 3 09:00 - Every 3 days at 9 AM\n• 5 20:00 - Every 5 days at 8 PM\n\n📝 Reply with: N HH:MM',

  // --- Analytics ---
  'analytics.intro': '📊 *Your Habits Analytics*\n\nView detailed analytics and graphs for all your habits.\n\nClick the link below to see:\n• Streak trends over time\n• Completion statistics\n• Skipped and dropped days\n• Timeline of all check events',
  'analytics.btn.open': '📊 Open Analytics',

  // --- New habit ---
  'newhabit.prompt':
    '📝 What would you like to name your new habit?\n\n' +
    'Just type the name and send it to me.',

  // --- Settings ---
  'settings.title': '⚙️ *Settings*',
  'settings.current': '*Current Settings:*',
  'settings.timezone_label': '🌍 Timezone: {value}',
  'settings.language_label': '🌐 Language: {value}',
  'settings.select_option': 'Select an option to change:',
  'settings.btn.timezone': '🌍 Change Timezone',
  'settings.btn.language': '🌐 Language',
  'settings.btn.admin': 'Admin Panel',
  'settings.back': '← Back to Settings',
  'settings.timezone.title':
    '🌍 *Change Timezone*\n\n' +
    'Look at the clock on your phone and pick the time that matches.',
  'settings.timezone.updated': '✅ Timezone updated to {tz}\n\nReturning to settings...',
  'settings.language.title': '🌐 *Change language*\n\nPick the language you want to use.',
  'settings.language.updated': '✅ Language updated to *{lang}*\n\nReturning to settings...',

  // --- Unhandled message ---
  'unhandled.reply':
    "🤔 Sorry, I can't process that message.\n\n" +
    "I'm a habit-tracking bot, so I only understand a few commands. Here's what you can do:\n\n" +
    '➕ /newhabit — Create a new habit to track\n' +
    '📋 /myhabits — View all your habits\n' +
    '📊 /analytics — View your habits analytics\n' +
    '⚙️ /settings — Manage your settings\n\n' +
    'Tip: you can also tap the menu button (☰) next to the message box to see the commands.',
};
