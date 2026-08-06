// Russian dictionary. Keys mirror en.ts (parity test enforces this).
export const ru: Record<string, string> = {
  // --- Onboarding: language ---
  'onboarding.language.confirmed':
    '✅ Язык установлен: *{lang}*.\n\n' +
    'Теперь настроим ваш часовой пояс, чтобы напоминания приходили вовремя.',

  // --- Onboarding: timezone ---
  'onboarding.timezone.prompt':
    '🌍 *Добро пожаловать в Habits Tracker!*\n\n' +
    'Посмотрите на часы в своём телефоне и выберите совпадающее время.\n\n' +
    'Это можно изменить позже в настройках.',
  'onboarding.timezone.set': '✅ Часовой пояс установлен: {tz}',

  // --- Welcome ---
  'welcome':
    '✨ _Выбирай лучшее, и привычка сделает это приятным и лёгким._ ✨\n' +
    '— Плутарх\n\n' +
    '*Добро пожаловать в Habits Tracker! 🎯*\n\n' +
    'Команды:\n' +
    '/newhabit - Создать новую привычку\n\n' +
    '/myhabits - Посмотреть все привычки\n\n' +
    '/analytics - Подробная аналитика и графики\n\n' +
    '/settings - Управление настройками\n\n' +
    'Бот будет напоминать вам отмечать привычки! ⏰\n\n',

  // --- Common ---
  'setup.required': 'Сначала завершите настройку, отправив /start',
  'common.not_set': 'Не установлено',

  // --- Command menu descriptions (setMyCommands) ---
  'cmd.newhabit': 'Создать новую привычку',
  'cmd.myhabits': 'Посмотреть все привычки',
  'cmd.analytics': 'Аналитика ваших привычек',
  'cmd.settings': 'Управление настройками',

  // --- Reminders ---
  'reminder.ask': '⏰ Напоминание: вы выполнили "{name}" сегодня?',
  'reminder.btn.yes': '✅ Да',
  'reminder.btn.no': '❌ Нет (сбросить серию)',
  'reminder.btn.skip': '⏭️ Пропустить (сохранить серию)',
  'reminder.btn.later': '🕐 Напомнить позже (через 1 час)',
  'reminder.btn.miniapp': '📱 Ответить в MiniApp',
  'reminder.postponed': '🕐 Хорошо — я напомню о "{name}" примерно в {time}.',
  'reminder.too_late': 'Уже поздно откладывать "{name}" сегодня — нажмите ✅ / ⏭️ / ❌, когда сможете.',
  'reminder.already_recorded': '✅ "{name}" уже отмечено на сегодня.',
  'reminder.habit_not_found': 'Привычка не найдена.',
  'reminder.all_checked': '✅ Все привычки отмечены на сегодня! Отличная работа! 🎉',
  'reminder.resumed': '▶️ Напоминания для "{name}" возобновлены. Я продолжу напоминать.',
  'reminder.paused_notice': '😴 Вы давно не отвечали на напоминания о "{name}", поэтому я приостановил их на {days} дн., чтобы не надоедать. Нажмите «Возобновить», чтобы снова их включить.',
  'reminder.btn.resume': '▶️ Возобновить сейчас',

  // --- Common ---
  'common.unable_identify': 'Не удалось определить пользователя.',
  'common.view_all': 'Посмотреть все привычки: /myhabits',
  'habits.not_found': 'Привычка не найдена',

  // --- Habits list ---
  'habits.list.empty': 'У вас пока нет привычек. Создайте первую командой /newhabit <название>',
  'habits.list.header': '📋 Ваши привычки:',
  'habits.list.footer': 'Нажмите на привычку, чтобы посмотреть детали или удалить её.',
  'habits.list.streak': '🔥 Серия: {streak} дн.',
  'habits.list.skipped': '⏭️ Пропущено: {count} дн.',
  'habits.list.skipped_on': '📅 Пропущено: {dates}',
  'habits.status.active': '▶️ Активна',
  'habits.status.disabled': '⏸️ Отключена',

  // --- Habit details ---
  'habits.details.title': '📋 Детали привычки',
  'habits.details.name': 'Название: {name}',
  'habits.details.status': 'Статус: {status}',
  'habits.details.streak': '🔥 Серия: {streak} дн.',
  'habits.details.badges': '🏆 Награды: {badges}',
  'habits.details.skipped': '⏭️ Пропущено дней: {count}',
  'habits.details.reminder': '⏰ Напоминание: {schedule} ({status})',
  'habits.details.last_checked': '📅 Последняя отметка: {date}',
  'habits.details.created': '📆 Создано: {date}',
  'habits.details.never': 'Никогда',
  'habits.reminder_on': '✅ Включено',
  'habits.reminder_off': '❌ Выключено',
  'habits.toast.enabled': 'Привычка включена',
  'habits.toast.disabled': 'Привычка отключена',
  'habits.deleted': '✅ Привычка "{name}" успешно удалена!',
  'habits.delete.confirm': '⚠️ Вы уверены, что хотите удалить "{name}"?\n\nЭто действие нельзя отменить.',

  // --- Buttons (habits / schedule) ---
  'btn.enable': '▶️ Включить привычку',
  'btn.disable': '⏸️ Отключить привычку',
  'btn.set_schedule': '⏰ Настроить напоминание',
  'btn.delete': '🗑️ Удалить привычку',
  'btn.delete_yes': '✅ Да, удалить',
  'btn.cancel': '❌ Отмена',
  'btn.back': '← Назад',
  'btn.back_to_list': '← К списку',
  'btn.sounds_good': '👍 Хорошо',
  'btn.change_time': '🕐 Изменить время',
  'btn.different_schedule': '📅 Другой график',
  'btn.custom_time': '⌨️ Своё время',
  'btn.daily': '📅 Ежедневно',
  'btn.weekly': '📆 Еженедельно',
  'btn.monthly': '🗓️ Ежемесячно',
  'btn.interval': '⏱️ Интервал',
  'btn.configure_miniapp': '🌐 Настроить в MiniApp',

  // --- Check / skip ---
  'check.reset': 'Серия сброшена. Можно начать заново завтра! 💪',
  'check.sprouted': '🌱 Ваше семечко проросло! Серия для "{name}" теперь 1 день!',
  'check.first_badge': 'Ещё {days} дн. до вашей первой награды {emoji}',
  'check.great': 'Отлично! Ваша серия для "{name}" теперь {streak} дн.! 🔥',
  'check.checked': 'Отмечено!',
  'skip.confirm': 'Вы уверены, что хотите пропустить "{name}" сегодня?\n\n⏭️ Ваша серия будет сохранена.',
  'skip.btn.yes': '✅ Да, пропустить',
  'skip.result': '⏭️ Пропущено "{name}" сегодня. Ваша серия в {streak} дн. сохранена! 💪',

  // --- New habit / schedule setup ---
  'newhabit.name_empty': '❌ Название привычки не может быть пустым. Попробуйте ещё раз через /newhabit',
  'newhabit.name_is_command': '❌ Укажите название привычки, а не команду. Попробуйте ещё раз через /newhabit',
  'newhabit.provide_name': 'Укажите название привычки: /newhabit <название>',
  'newhabit.created_simple': '🌱 Привычка "{name}" создана! Ваше семечко посажено.\n\nПосмотреть все привычки: /myhabits',
  'create.confirm': '🌱 Привычка "{name}" создана! Ваше семечко посажено.\n\n⏰ Будем напоминать вам *каждый день в {time}* ({tz}).\n\nНажмите *👍 Хорошо*, чтобы завершить — или измените напоминание ниже.',
  'create.confirm.tip': '💡 *Совет:* начать с одной привычки — лучший способ выработать постоянство. Дайте себе несколько дней войти в ритм, прежде чем добавлять новые — вы удивитесь, насколько легче её придерживаться!',
  'create.planted': '🌱 "{name}" посажено.\n\n⏰ Будем напоминать вам *каждый день в {time}* ({tz}).\n\nНажмите *👍 Хорошо*, чтобы завершить — или измените напоминание ниже.',
  'create.ready_full': '✅ "{name}" готово! Ваше семечко в земле.\n\n⏰ {schedule}\n\nПосмотреть все привычки: /myhabits',
  'create.ready_short': '✅ "{name}" готово!\n\n⏰ {schedule}\n\nПосмотреть все привычки: /myhabits',
  'schedule.not_available': 'Управление расписанием недоступно.',
  'schedule.not_available_support': 'Управление расписанием недоступно. Обратитесь в поддержку.',
  'schedule.options_expired': 'Время выбора истекло. Попробуйте ещё раз.',
  'schedule.invalid_state': 'Некорректное состояние диалога. Попробуйте ещё раз.',
  'schedule.unknown_type': 'Неизвестный тип расписания.',
  'schedule.habit_or_unavailable': 'Ошибка: привычка не найдена или управление расписанием недоступно.',
  'schedule.pick_time': '🕐 В какое время каждый день напоминать о "{name}"?\n\nВыберите время или нажмите *⌨️ Своё время*, чтобы ввести своё (ЧЧ:ММ).',
  'schedule.more': '📅 Как часто напоминать о "{name}"?\n\nВыберите тип расписания ниже.',
  'schedule.dsl.completion_new': '🌱 Привычка "{name}" готова! Ваше семечко в земле.\n\nРасписание: {schedule}\n\nПосмотреть все привычки: /myhabits',
  'schedule.dsl.completion_update': '✅ Расписание напоминаний обновлено!\n\nПривычка: {name}\nРасписание: {schedule}',
  'schedule.set': '⏰ Настройка напоминаний для "{name}"\n\nСейчас: {current}\n\nВыберите тип расписания:',
  'schedule.type.daily': '⏰ Ежедневное расписание\n\nВведите время для ежедневных напоминаний.\n\nПримеры:\n• 20:30 - каждый день в 20:30\n• 09:00 - каждый день в 09:00\n\n📝 Отправьте в формате: ЧЧ:ММ',
  'schedule.type.weekly': '⏰ Еженедельное расписание\n\nВведите дни и время для еженедельных напоминаний.\n\nПримеры:\n• monday 18:00 - каждый понедельник в 18:00\n• tuesday,saturday 20:00 - каждый вторник и субботу в 20:00\n• monday,wednesday,friday 08:00 - пн/ср/пт в 08:00\n\nДни: sunday, monday, tuesday, wednesday, thursday, friday, saturday\n\n📝 Отправьте в формате: day1,day2 ЧЧ:ММ',
  'schedule.type.monthly': '⏰ Ежемесячное расписание\n\nВведите день(-и) месяца и время для ежемесячных напоминаний.\n\nПримеры:\n• 15 15:42 - 15-го числа каждого месяца в 15:42\n• 20,26 22:00 - 20-го и 26-го в 22:00\n• 1,15 09:00 - 1-го и 15-го в 09:00\n\n📝 Отправьте в формате: day1,day2 ЧЧ:ММ',
  'schedule.type.interval': '⏰ Расписание с интервалом\n\nВведите количество дней и время для напоминаний с интервалом.\n\nПримеры:\n• 2 15:30 - каждые 2 дня в 15:30\n• 3 09:00 - каждые 3 дня в 09:00\n• 5 20:00 - каждые 5 дней в 20:00\n\n📝 Отправьте в формате: N ЧЧ:ММ',

  // --- Analytics ---
  'analytics.intro': '📊 *Аналитика ваших привычек*\n\nПодробная аналитика и графики по всем вашим привычкам.\n\nНажмите ссылку ниже, чтобы увидеть:\n• Динамику серий во времени\n• Статистику выполнения\n• Пропущенные и сброшенные дни\n• Хронологию всех отметок',
  'analytics.btn.open': '📊 Открыть аналитику',

  // --- New habit ---
  'newhabit.prompt':
    '📝 Как назвать новую привычку?\n\n' +
    'Просто введите название и отправьте его мне.',

  // --- Settings ---
  'settings.title': '⚙️ *Настройки*',
  'settings.current': '*Текущие настройки:*',
  'settings.timezone_label': '🌍 Часовой пояс: {value}',
  'settings.language_label': '🌐 Язык: {value}',
  'settings.select_option': 'Выберите, что изменить:',
  'settings.btn.timezone': '🌍 Изменить часовой пояс',
  'settings.btn.language': '🌐 Язык',
  'settings.btn.admin': 'Админ-панель',
  'settings.back': '← Назад к настройкам',
  'settings.timezone.title':
    '🌍 *Изменение часового пояса*\n\n' +
    'Посмотрите на часы в своём телефоне и выберите совпадающее время.',
  'settings.timezone.updated': '✅ Часовой пояс обновлён: {tz}\n\nВозвращаемся к настройкам...',
  'settings.language.title': '🌐 *Изменение языка*\n\nВыберите язык, который хотите использовать.',
  'settings.language.updated': '✅ Язык обновлён: *{lang}*\n\nВозвращаемся к настройкам...',

  // --- Unhandled message ---
  'unhandled.reply':
    '🤔 Извините, я не могу обработать это сообщение.\n\n' +
    'Я бот для отслеживания привычек и понимаю только несколько команд. Вот что вы можете сделать:\n\n' +
    '➕ /newhabit — Создать новую привычку\n' +
    '📋 /myhabits — Посмотреть все привычки\n' +
    '📊 /analytics — Аналитика ваших привычек\n' +
    '⚙️ /settings — Управление настройками\n\n' +
    'Совет: вы также можете нажать кнопку меню (☰) рядом с полем ввода, чтобы увидеть команды.',
};
