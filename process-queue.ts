import * as fs from 'fs';
import * as path from 'path';
import { chromium, Page, Browser } from '@playwright/test';
import { WriteStream } from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables from .env file for local testing
dotenv.config();

// Define types for our queue data
interface TimeRange {
  start: number;
  end: number;
}

interface BookingRequest {
  id: string;
  requestDate: string;
  playDate: string;
  timeRange: TimeRange;
  status: 'pending' | 'success' | 'failed' | 'error';
  requestedBy: string;
  processedDate?: string;
  bookedTime?: string;
  confirmationNumber?: string;
  failureReason?: string;
}

interface QueueData {
  bookingRequests: BookingRequest[];
  processedRequests: BookingRequest[];
}

interface AvailableTime {
  time: string;
  id: string;
}

// Local testing flags
const isTestMode = process.env.TEST_MODE === 'true';
const simulateBooking = process.env.SIMULATE_BOOKING === 'true';

// Setup logging
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFilePath = path.join(logDir, `processing-${new Date().toISOString().replace(/:/g, '-')}.log`);
const logStream: WriteStream = fs.createWriteStream(logFilePath, { flags: 'a' });

const log = (message: string): void => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  logStream.write(logMessage + '\n');
};

// Get queue file path (adjust for testing)
const getQueueFilePath = (): string => {
  return isTestMode 
    ? path.join(__dirname, 'test-booking-queue.json')
    : path.join(__dirname, 'booking-queue.json');
};

// Create mock data for testing
const createTestData = (): void => {
  const queuePath = getQueueFilePath();
  
  if (isTestMode && !fs.existsSync(queuePath)) {
    log('Creating test queue data');
    
    // Create a test request for today
    const today = new Date().toISOString().split('T')[0];
    const testQueue: QueueData = {
      bookingRequests: [
        {
          id: `test-${Date.now()}`,
          requestDate: new Date().toISOString(),
          playDate: today,
          timeRange: {
            start: 8,
            end: 12
          },
          status: 'pending',
          requestedBy: 'test-user'
        }
      ],
      processedRequests: []
    };
    
    fs.writeFileSync(queuePath, JSON.stringify(testQueue, null, 2));
    log(`Created test queue file at ${queuePath}`);
  }
};

// Mock the browser interactions for testing
const mockBrowserActions = async (): Promise<void> => {
  log('SIMULATION MODE: Mocking browser interactions');
  
  // Simulate a 2-second delay for "browser startup"
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Simulate login
  log('SIMULATION: Logged in successfully');
  
  // Simulate booking page navigation
  log('SIMULATION: Navigated to booking page');
  
  // Simulate finding available times
  const mockAvailableTimes: AvailableTime[] = [
    { time: '09:30', id: 'mock-time-1' },
    { time: '10:15', id: 'mock-time-2' },
    { time: '11:00', id: 'mock-time-3' }
  ];
  
  log(`SIMULATION: Found ${mockAvailableTimes.length} available times`);
  return;
};

const logEmptyBooking = (queuePath: string): void => {
  log(`No booking queue found at ${queuePath}. Creating empty queue.`);
  const emptyQueue: QueueData = {
    bookingRequests: [],
    processedRequests: []
  };
  fs.writeFileSync(queuePath, JSON.stringify(emptyQueue, null, 2));
  console.log('::set-output name=processed_count::0');
  console.log('::set-output name=results::No booking requests in queue.');
  return;
}

async function initializeQueue(): Promise<QueueData> {
  const queuePath = getQueueFilePath();

  if (!fs.existsSync(queuePath)) {
    logEmptyBooking(queuePath);
    return { bookingRequests: [], processedRequests: [] };
  }

  return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
}

function filterTodayRequests(queueData: QueueData): BookingRequest[] {
  const today = new Date().toISOString().split('T')[0];
  return queueData.bookingRequests.filter(request =>
    request.playDate === today && request.status === 'pending'
  );
}

async function simulateProcessingRequests(
  todayRequests: BookingRequest[],
  queueData: QueueData,
  queuePath: string
): Promise<{ results: string; processedCount: number }> {
  await mockBrowserActions();
  let results = '';
  let processedCount = 0;

  for (const request of todayRequests) {
    log(`SIMULATION: Processing request ${request.id} for ${request.playDate}`);
    request.status = 'success';
    request.processedDate = new Date().toISOString();
    request.bookedTime = '09:30';
    request.confirmationNumber = `SIM-${Math.floor(100000 + Math.random() * 900000)}`;
    log(`SIMULATION: Successfully booked tee time at ${request.bookedTime}`);
    log(`SIMULATION: Confirmation number: ${request.confirmationNumber}`);
    results += `✅ Request ${request.id}: Booked for ${request.bookedTime} (Confirmation: ${request.confirmationNumber})\n`;
    processedCount++;
  }

  queueData.bookingRequests = queueData.bookingRequests.filter(request =>
    !(request.playDate === new Date().toISOString().split('T')[0] && request.status !== 'pending')
  );
  queueData.processedRequests = [...todayRequests, ...queueData.processedRequests];
  fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
  return { results, processedCount };
}

async function processRealRequests(
  todayRequests: BookingRequest[],
  queueData: QueueData,
  queuePath: string
): Promise<{ results: string; processedCount: number }> {
  let results = '';
  let processedCount = 0;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: !isTestMode });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    const page = await context.newPage();
    await loginToWebsite(page);

    for (const request of todayRequests) {
      const result = await processSingleRequest(page, request);
      results += result.message;
      processedCount += result.success ? 1 : 0;
    }
  } catch (error) {
    log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (browser) await browser.close();
  }

  queueData.bookingRequests = queueData.bookingRequests.filter(request =>
    !(request.playDate === new Date().toISOString().split('T')[0] && request.status !== 'pending')
  );
  queueData.processedRequests = [...todayRequests, ...queueData.processedRequests];
  fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
  return { results, processedCount };
}

async function loginToWebsite(page: Page): Promise<void> {
  log('Logging in to golf course website');
  await page.goto('https://yourgolfcourse.com/login');
  const username = process.env.GOLF_USERNAME;
  const password = process.env.GOLF_PASSWORD;

  if (!username || !password) {
    throw new Error('Golf course credentials not found in environment variables');
  }

  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#login-button');
  await page.waitForSelector('.logged-in-indicator', { timeout: 10000 }).catch(() => {
    log('WARNING: Could not detect login success indicator');
  });
}

async function processSingleRequest(page: Page, request: BookingRequest): Promise<{ message: string; success: boolean }> {
  try {
    log(`Processing request ${request.id} for ${request.playDate}`);
    await page.goto('https://yourgolfcourse.com/book-tee-time');
    await page.click('#date-picker');
    await page.click(`[data-date="${request.playDate}"]`);

    const availableTimes = await page.evaluate(({ start, end }) => {
      const times = Array.from(document.querySelectorAll('.tee-time-slot:not(.booked)'));
      return times
        .map(slot => ({
          time: slot.getAttribute('data-time'),
          id: slot.getAttribute('data-id')
        }))
        .filter(slot => {
          const time = slot.time;
          if (!time) return false;
          const slotHour = parseInt(time.split(':')[0]);
          return slotHour >= start && slotHour <= end;
        });
    }, request.timeRange) as AvailableTime[];

    if (availableTimes.length > 0) {
      availableTimes.sort((a, b) => a.time.localeCompare(b.time));
      await page.click(`[data-id="${availableTimes[0].id}"]`);
      await page.click('#confirm-booking');
      await page.waitForSelector('.booking-confirmation', { timeout: 15000 });

      const confirmationNumber = await page.evaluate(() => {
        const element = document.querySelector('.confirmation-number');
        return element ? element.textContent || '' : '';
      });

      request.status = 'success';
      request.processedDate = new Date().toISOString();
      request.bookedTime = availableTimes[0].time;
      request.confirmationNumber = confirmationNumber;

      return {
        message: `✅ Request ${request.id}: Booked for ${availableTimes[0].time} (Confirmation: ${confirmationNumber})\n`,
        success: true
      };
    } else {
      request.status = 'failed';
      request.processedDate = new Date().toISOString();
      request.failureReason = 'No available times in specified range';

      return {
        message: `❌ Request ${request.id}: No available times between ${request.timeRange.start}:00 and ${request.timeRange.end}:00\n`,
        success: false
      };
    }
  } catch (error) {
    request.status = 'error';
    request.processedDate = new Date().toISOString();
    request.failureReason = error instanceof Error ? error.message : String(error);

    return {
      message: `⚠️ Request ${request.id}: Error - ${request.failureReason}\n`,
      success: false
    };
  }
}

async function processQueue(): Promise<void> {
  log('Starting booking queue processing');
  log(`Running in ${isTestMode ? 'TEST' : 'PRODUCTION'} mode`);

  if (isTestMode) {
    createTestData();
  }

  const queueData = await initializeQueue();
  const todayRequests = filterTodayRequests(queueData);

  if (todayRequests.length === 0) {
    log(`No booking requests for today (${new Date().toISOString().split('T')[0]})`);
    console.log('::set-output name=processed_count::0');
    console.log('::set-output name=results::No booking requests for today.');
    return;
  }

  log(`Found ${todayRequests.length} booking requests for today`);

  const queuePath = getQueueFilePath();
  const { results, processedCount } = isTestMode && simulateBooking
    ? await simulateProcessingRequests(todayRequests, queueData, queuePath)
    : await processRealRequests(todayRequests, queueData, queuePath);

  log(`Processed ${processedCount} requests`);
  console.log(`::set-output name=processed_count::${processedCount}`);
  console.log(`::set-output name=results::${results}`);
  logStream.end();
}

// Run the processor
processQueue()
  .catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
    
    log(`FATAL ERROR: ${errorMessage}`);
    log(stackTrace || '');
    logStream.end();
    process.exit(1);
  });