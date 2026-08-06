// Ukrainian dictionary. Keys mirror en.ts (parity test enforces this).
export const uk: Record<string, string> = {
  // --- Onboarding: language ---
  'onboarding.language.confirmed':
    '✅ Мову встановлено: *{lang}*.\n\n' +
    'Тепер налаштуймо ваш часовий пояс, щоб нагадування приходили вчасно.',

  // --- Onboarding: timezone ---
  'onboarding.timezone.prompt':
    '🌍 *Ласкаво просимо до Habits Tracker!*\n\n' +
    'Подивіться на годинник у своєму телефоні й оберіть час, який збігається.\n\n' +
    'Це можна змінити пізніше в налаштуваннях.',
  'onboarding.timezone.set': '✅ Часовий пояс встановлено: {tz}',

  // --- Welcome ---
  'welcome':
    '✨ _Обирай найкраще, і звичка зробить його приємним і легким._ ✨\n' +
    '— Плутарх\n\n' +
    '*Ласкаво просимо до Habits Tracker! 🎯*\n\n' +
    'Команди:\n' +
    '/newhabit - Створити нову звичку\n\n' +
    '/myhabits - Переглянути всі звички\n\n' +
    '/analytics - Детальна аналітика та графіки\n\n' +
    '/settings - Керувати налаштуваннями\n\n' +
    'Бот нагадуватиме вам відмічати звички! ⏰\n\n',

  // --- Common ---
  'setup.required': 'Спершу завершіть налаштування, надіславши /start',
  'common.not_set': 'Не встановлено',

  // --- Command menu descriptions (setMyCommands) ---
  'cmd.newhabit': 'Створити нову звичку',
  'cmd.myhabits': 'Переглянути всі звички',
  'cmd.analytics': 'Аналітика ваших звичок',
  'cmd.settings': 'Керувати налаштуваннями',

  // --- Reminders ---
  'reminder.ask': '⏰ Нагадування: чи виконали ви "{name}" сьогодні?',
  'reminder.btn.yes': '✅ Так',
  'reminder.btn.no': '❌ Ні (скинути серію)',
  'reminder.btn.skip': '⏭️ Пропустити (зберегти серію)',
  'reminder.btn.later': '🕐 Нагадати пізніше (за 1 годину)',
  'reminder.btn.miniapp': '📱 Відповісти в MiniApp',
  'reminder.postponed': '🕐 Гаразд — я нагадаю про "{name}" приблизно о {time}.',
  'reminder.too_late': 'Уже пізно відкладати "{name}" сьогодні — натисніть ✅ / ⏭️ / ❌, коли зможете.',
  'reminder.already_recorded': '✅ "{name}" вже відмічено на сьогодні.',
  'reminder.habit_not_found': 'Звичку не знайдено.',
  'reminder.all_checked': '✅ Усі звички відмічено на сьогодні! Чудова робота! 🎉',
  'reminder.resumed': '▶️ Нагадування для "{name}" відновлено. Я продовжуватиму нагадувати.',
  'reminder.paused_notice': '😴 Ви давно не відповідали на нагадування про "{name}", тож я призупинив їх на {days} дн., щоб не набридати. Натисніть «Відновити», щоб знову їх увімкнути.',
  'reminder.btn.resume': '▶️ Відновити зараз',

  // --- Common ---
  'common.unable_identify': 'Не вдалося визначити користувача.',
  'common.view_all': 'Переглянути всі звички: /myhabits',
  'habits.not_found': 'Звичку не знайдено',

  // --- Habits list ---
  'habits.list.empty': 'У вас ще немає звичок. Створіть першу командою /newhabit <назва>',
  'habits.list.header': '📋 Ваші звички:',
  'habits.list.footer': 'Натисніть на звичку, щоб переглянути деталі або видалити її.',
  'habits.list.streak': '🔥 Серія: {streak} дн.',
  'habits.list.skipped': '⏭️ Пропущено: {count} дн.',
  'habits.list.skipped_on': '📅 Пропущено: {dates}',
  'habits.status.active': '▶️ Активна',
  'habits.status.disabled': '⏸️ Вимкнена',

  // --- Habit details ---
  'habits.details.title': '📋 Деталі звички',
  'habits.details.name': 'Назва: {name}',
  'habits.details.status': 'Стан: {status}',
  'habits.details.streak': '🔥 Серія: {streak} дн.',
  'habits.details.badges': '🏆 Нагороди: {badges}',
  'habits.details.skipped': '⏭️ Пропущено днів: {count}',
  'habits.details.reminder': '⏰ Нагадування: {schedule} ({status})',
  'habits.details.last_checked': '📅 Востаннє відмічено: {date}',
  'habits.details.created': '📆 Створено: {date}',
  'habits.details.never': 'Ніколи',
  'habits.reminder_on': '✅ Увімкнено',
  'habits.reminder_off': '❌ Вимкнено',
  'habits.toast.enabled': 'Звичку увімкнено',
  'habits.toast.disabled': 'Звичку вимкнено',
  'habits.deleted': '✅ Звичку "{name}" успішно видалено!',
  'habits.delete.confirm': '⚠️ Ви впевнені, що хочете видалити "{name}"?\n\nЦю дію не можна скасувати.',

  // --- Buttons (habits / schedule) ---
  'btn.enable': '▶️ Увімкнути звичку',
  'btn.disable': '⏸️ Вимкнути звичку',
  'btn.set_schedule': '⏰ Налаштувати нагадування',
  'btn.delete': '🗑️ Видалити звичку',
  'btn.delete_yes': '✅ Так, видалити',
  'btn.cancel': '❌ Скасувати',
  'btn.back': '← Назад',
  'btn.back_to_list': '← До списку',
  'btn.sounds_good': '👍 Гаразд',
  'btn.change_time': '🕐 Змінити час',
  'btn.different_schedule': '📅 Інший розклад',
  'btn.custom_time': '⌨️ Свій час',
  'btn.daily': '📅 Щодня',
  'btn.weekly': '📆 Щотижня',
  'btn.monthly': '🗓️ Щомісяця',
  'btn.interval': '⏱️ Інтервал',
  'btn.configure_miniapp': '🌐 Налаштувати в MiniApp',

  // --- Check / skip ---
  'check.reset': 'Серію скинуто. Можна почати заново завтра! 💪',
  'check.sprouted': '🌱 Ваше зернятко проросло! Серія для "{name}" тепер 1 день!',
  'check.first_badge': 'Ще {days} дн. до вашої першої нагороди {emoji}',
  'check.great': 'Чудово! Ваша серія для "{name}" тепер {streak} дн.! 🔥',
  'check.checked': 'Відмічено!',
  'skip.confirm': 'Ви впевнені, що хочете пропустити "{name}" сьогодні?\n\n⏭️ Вашу серію буде збережено.',
  'skip.btn.yes': '✅ Так, пропустити',
  'skip.result': '⏭️ Пропущено "{name}" сьогодні. Вашу серію в {streak} дн. збережено! 💪',

  // --- New habit / schedule setup ---
  'newhabit.name_empty': '❌ Назва звички не може бути порожньою. Спробуйте ще раз через /newhabit',
  'newhabit.name_is_command': '❌ Вкажіть назву звички, а не команду. Спробуйте ще раз через /newhabit',
  'newhabit.provide_name': 'Вкажіть назву звички: /newhabit <назва>',
  'newhabit.created_simple': '🌱 Звичку "{name}" створено! Ваше зернятко посаджено.\n\nПереглянути всі звички: /myhabits',
  'create.confirm': '🌱 Звичку "{name}" створено! Ваше зернятко посаджено.\n\n⏰ Нагадуватимемо вам *щодня о {time}* ({tz}).\n\nНатисніть *👍 Гаразд*, щоб завершити — або змініть нагадування нижче.',
  'create.confirm.tip': '💡 *Порада:* почати з однієї звички — найкращий спосіб виробити сталість. Дайте собі кілька днів увійти в ритм, перш ніж додавати більше — ви здивуєтесь, наскільки легше її дотримуватися!',
  'create.planted': '🌱 "{name}" посаджено.\n\n⏰ Нагадуватимемо вам *щодня о {time}* ({tz}).\n\nНатисніть *👍 Гаразд*, щоб завершити — або змініть нагадування нижче.',
  'create.ready_full': '✅ "{name}" готово! Ваше зернятко в землі.\n\n⏰ {schedule}\n\nПереглянути всі звички: /myhabits',
  'create.ready_short': '✅ "{name}" готово!\n\n⏰ {schedule}\n\nПереглянути всі звички: /myhabits',
  'schedule.not_available': 'Керування розкладом недоступне.',
  'schedule.not_available_support': 'Керування розкладом недоступне. Зверніться до підтримки.',
  'schedule.options_expired': 'Час вибору минув. Спробуйте ще раз.',
  'schedule.invalid_state': 'Некоректний стан діалогу. Спробуйте ще раз.',
  'schedule.unknown_type': 'Невідомий тип розкладу.',
  'schedule.habit_or_unavailable': 'Помилка: звичку не знайдено або керування розкладом недоступне.',
  'schedule.pick_time': '🕐 О котрій годині щодня нагадувати про "{name}"?\n\nОберіть час або натисніть *⌨️ Свій час*, щоб ввести власний (ГГ:ХХ).',
  'schedule.more': '📅 Як часто нагадувати про "{name}"?\n\nОберіть тип розкладу нижче.',
  'schedule.dsl.completion_new': '🌱 Звичку "{name}" готово! Ваше зернятко в землі.\n\nРозклад: {schedule}\n\nПереглянути всі звички: /myhabits',
  'schedule.dsl.completion_update': '✅ Розклад нагадувань оновлено!\n\nЗвичка: {name}\nРозклад: {schedule}',
  'schedule.set': '⏰ Налаштування нагадувань для "{name}"\n\nЗараз: {current}\n\nОберіть тип розкладу:',
  'schedule.type.daily': '⏰ Щоденний розклад\n\nВведіть час для щоденних нагадувань.\n\nПриклади:\n• 20:30 - щодня о 20:30\n• 09:00 - щодня о 09:00\n\n📝 Надішліть у форматі: ГГ:ХХ',
  'schedule.type.weekly': '⏰ Щотижневий розклад\n\nВведіть дні й час для щотижневих нагадувань.\n\nПриклади:\n• monday 18:00 - щопонеділка о 18:00\n• tuesday,saturday 20:00 - щовівторка та щосуботи о 20:00\n• monday,wednesday,friday 08:00 - пн/ср/пт о 08:00\n\nДні: sunday, monday, tuesday, wednesday, thursday, friday, saturday\n\n📝 Надішліть у форматі: day1,day2 ГГ:ХХ',
  'schedule.type.monthly': '⏰ Щомісячний розклад\n\nВведіть день(-ні) місяця й час для щомісячних нагадувань.\n\nПриклади:\n• 15 15:42 - 15-го числа щомісяця о 15:42\n• 20,26 22:00 - 20-го та 26-го о 22:00\n• 1,15 09:00 - 1-го та 15-го о 09:00\n\n📝 Надішліть у форматі: day1,day2 ГГ:ХХ',
  'schedule.type.interval': '⏰ Розклад з інтервалом\n\nВведіть кількість днів і час для нагадувань з інтервалом.\n\nПриклади:\n• 2 15:30 - кожні 2 дні о 15:30\n• 3 09:00 - кожні 3 дні о 09:00\n• 5 20:00 - кожні 5 днів о 20:00\n\n📝 Надішліть у форматі: N ГГ:ХХ',

  // --- Analytics ---
  'analytics.intro': '📊 *Аналітика ваших звичок*\n\nДетальна аналітика та графіки для всіх ваших звичок.\n\nНатисніть посилання нижче, щоб побачити:\n• Динаміку серій у часі\n• Статистику виконання\n• Пропущені та скинуті дні\n• Хронологію всіх відміток',
  'analytics.btn.open': '📊 Відкрити аналітику',

  // --- New habit ---
  'newhabit.prompt':
    '📝 Як назвати нову звичку?\n\n' +
    'Просто введіть назву й надішліть її мені.',

  // --- Settings ---
  'settings.title': '⚙️ *Налаштування*',
  'settings.current': '*Поточні налаштування:*',
  'settings.timezone_label': '🌍 Часовий пояс: {value}',
  'settings.language_label': '🌐 Мова: {value}',
  'settings.select_option': 'Оберіть, що змінити:',
  'settings.btn.timezone': '🌍 Змінити часовий пояс',
  'settings.btn.language': '🌐 Мова',
  'settings.btn.admin': 'Адмін-панель',
  'settings.back': '← Назад до налаштувань',
  'settings.timezone.title':
    '🌍 *Зміна часового поясу*\n\n' +
    'Подивіться на годинник у своєму телефоні й оберіть час, який збігається.',
  'settings.timezone.updated': '✅ Часовий пояс оновлено: {tz}\n\nПовертаємось до налаштувань...',
  'settings.language.title': '🌐 *Зміна мови*\n\nОберіть мову, якою хочете користуватися.',
  'settings.language.updated': '✅ Мову оновлено: *{lang}*\n\nПовертаємось до налаштувань...',

  // --- Unhandled message ---
  'unhandled.reply':
    '🤔 Вибачте, я не можу обробити це повідомлення.\n\n' +
    'Я бот для відстеження звичок і розумію лише кілька команд. Ось що ви можете зробити:\n\n' +
    '➕ /newhabit — Створити нову звичку\n' +
    '📋 /myhabits — Переглянути всі звички\n' +
    '📊 /analytics — Аналітика ваших звичок\n' +
    '⚙️ /settings — Керувати налаштуваннями\n\n' +
    'Порада: ви також можете натиснути кнопку меню (☰) біля поля вводу, щоб побачити команди.',
};
