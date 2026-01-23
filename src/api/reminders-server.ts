import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../presentation/telegram/TelegramBot';
import { GetHabitsDueForReminderUseCase } from '../domain/use-cases/GetHabitsDueForReminderUseCase';
import { CreateHabitUseCase } from '../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from '../domain/use-cases/SetHabitReminderScheduleUseCase';
import { Habit } from '../domain/entities/Habit';
import { Logger } from '../infrastructure/logger/Logger';
import { computeCheckHistory } from '../domain/utils/HabitAnalytics';

// Helper functions defined before createRemindersServer
async function handleRemindersEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  botService: TelegramBotService,
  habitRepository: VercelKVHabitRepository,
  port: number
): Promise<void> {
  // Optional: Check for cron secret
  const url = req.url || '';
  const cronSecret = req.headers['x-cron-secret'] || new URL(url, `http://localhost:${port}`).searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    Logger.info('Starting hourly reminders request');
    
    // Get current time (UTC)
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    Logger.info('Checking for habits due for reminder', {
      currentHour,
      currentMinute,
      timezone: 'UTC',
    });

    // Get habits that are due for reminders right now based on their schedules
    const getHabitsDueForReminderUseCase = new GetHabitsDueForReminderUseCase(habitRepository);
    const habitsDue = await getHabitsDueForReminderUseCase.execute(now, currentHour, currentMinute, 'UTC');

    Logger.info('Found habits due for reminder', {
      count: habitsDue.length,
      habitIds: habitsDue.map(h => h.id),
    });

    // Group habits by user
    const habitsByUser = new Map<number, Habit[]>();
    for (const habit of habitsDue) {
      if (!habitsByUser.has(habit.userId)) {
        habitsByUser.set(habit.userId, []);
      }
      habitsByUser.get(habit.userId)!.push(habit);
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ userId: number; error: string }> = [];

    // Send reminders grouped by user
    for (const [userId, habits] of habitsByUser.entries()) {
      try {
        Logger.info('Sending reminder to user', { userId, habitCount: habits.length });
        await botService.sendHabitReminders(userId, habits);
        successCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.error('Error sending reminder to user', {
          userId,
          error: errorMessage,
        });
        errors.push({ userId, error: errorMessage });
        errorCount++;
      }
    }

    Logger.info('Hourly reminders request completed', {
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Reminders processed',
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    }));
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

async function handleAnalyticsEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  try {
    const url = new URL(req.url || '', `http://localhost:3000`);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'userId is required' }));
      return;
    }

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid userId' }));
      return;
    }

    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
    const habits = await getUserHabitsUseCase.execute(userIdNum);
    
    // Return habits with analytics data (compute checkHistory on demand)
    const analyticsData = habits.map(habit => ({
      id: habit.id,
      name: habit.name,
      streak: habit.streak,
      createdAt: habit.createdAt,
      lastCheckedDate: habit.lastCheckedDate,
      skipped: habit.skipped || [],
      dropped: habit.dropped || [],
      checkHistory: computeCheckHistory(habit), // Compute from streak, creation date, skips, and drops
      disabled: habit.disabled || false,
      reminderSchedule: habit.reminderSchedule,
      reminderEnabled: habit.reminderEnabled,
    }));

    Logger.info('Analytics data retrieved', {
      userId: userIdNum,
      habitCount: analyticsData.length,
    });

    // Set CORS headers to allow access from the web page
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ habits: analyticsData }));
  } catch (error) {
    Logger.error('Error fetching analytics data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

async function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<void> {
  console.log({__dirname});
  const publicDir = resolve(process.cwd(), 'public');
  
  // Handle analytics route: /analytics/{userId}
  const analyticsMatch = url.match(/^\/analytics\/(\d+)$/);
  if (analyticsMatch) {
    const userId = analyticsMatch[1];
    const analyticsPath = join(publicDir, 'analytics.html');
    console.log('ANALYTICS PATH', analyticsPath);
    console.log('EXISTS', existsSync(analyticsPath));
    console.log('STAT', statSync(analyticsPath));
    console.log('IS FILE', statSync(analyticsPath).isFile());
    if (existsSync(analyticsPath)) {
      let content = readFileSync(analyticsPath, 'utf-8');
      // Inject userId into the page (the JS will also read from URL, but this ensures it's available)
      content = content.replace(
        /const userId = .*?;/,
        `const userId = '${userId}';`
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
  }
  
  // Determine file path
  let filePath = url === '/' ? '/index.html' : url;
  // Remove leading slash and query parameters
  filePath = filePath.split('?')[0];
  filePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  
  const fullPath = resolve(publicDir, filePath);
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  
  // Check if file exists
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    // If file doesn't exist, try serving index.html for SPA routing
    const indexPath = join(publicDir, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  
  // Read and serve the file
  const content = readFileSync(fullPath);
  const ext = extname(fullPath).toLowerCase();
  
  // Set content type based on file extension
  const contentTypeMap: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };
  
  const contentType = contentTypeMap[ext] || 'application/octet-stream';
  
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

/**
 * Creates and returns an HTTP server for handling reminder requests
 * This server is used in local development - in production, reminders are handled by Vercel cron jobs
 * @param botService - The TelegramBotService instance to use for sending reminders
 * @param habitRepository - The habit repository instance
 * @param port - Port to listen on (default: 3000)
 * @returns The HTTP server instance
 */
export function createRemindersServer(
  botService: TelegramBotService,
  habitRepository: VercelKVHabitRepository,
  port: number = 3000
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    
    // Handle API routes
    if (url.startsWith('/api/')) {
      // Handle /api/reminders POST request
      if (req.method === 'POST' && url === '/api/reminders') {
        await handleRemindersEndpoint(req, res, botService, habitRepository, port);
        return;
      }
      
      // Handle /api/analytics GET request
      if (req.method === 'GET' && url.startsWith('/api/analytics')) {
        await handleAnalyticsEndpoint(req, res, habitRepository);
        return;
      }
      
      // Other API routes return 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    
    // Serve static files from public directory
    try {
      await serveStaticFile(req, res, url);
    } catch (error) {
      console.error('Error serving static file:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    console.log(`Reminders API server running on port ${port}`);
    console.log(`Static files served from public/ directory`);
  });

  return server;
}

// Standalone mode: if this file is run directly, create a separate bot instance
// This is kept for backward compatibility but shouldn't be used in normal development
if (require.main === module) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  console.log('WARNING: Running reminders-server in standalone mode (not recommended for development)');
  console.log('Use npm run dev instead, which runs both bot and reminders server in a single process');

  const habitRepository = new VercelKVHabitRepository();

  const createHabitUseCase = new CreateHabitUseCase(habitRepository);
  const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
  const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
  const deleteHabitUseCase = new DeleteHabitUseCase(habitRepository);
  const getHabitsToCheckUseCase = new GetHabitsToCheckUseCase(habitRepository);
  const setHabitReminderScheduleUseCase = new SetHabitReminderScheduleUseCase(habitRepository);

  const botService = new TelegramBotService(
    botToken,
    createHabitUseCase,
    getUserHabitsUseCase,
    recordHabitCheckUseCase,
    deleteHabitUseCase,
    getHabitsToCheckUseCase,
    false,
    setHabitReminderScheduleUseCase
  );

  const port = parseInt(process.env.PORT || '3000', 10);
  createRemindersServer(botService, habitRepository, port);
}
