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
  log(`No booking queue file found at ${queuePath}. Creating empty queue.`);
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

const navigateToBookingPage = async (page: Page): Promise<void> => {
  log('Navigating to booking page');
    await page.goto('https://lorabaygolf.clubhouseonline-e3.com/TeeTimes/TeeSheet.aspx');
    await page.getByText('My Bookings').waitFor({ timeout: 10000 }).catch(() => {
      log('WARNING: Could not detect navigation success indicator (My Bookings link)');
    });}

async function processRealRequests(
  todayRequests: BookingRequest[],
  queueData: QueueData,
  queuePath: string
): Promise<{ results: string; processedCount: number }> {
  let results = '';
  let processedCount = 0;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: false });//TODO: Set to true for production }});
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    const page = await context.newPage();
    await loginToWebsite(page);
    await navigateToBookingPage(page);
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
  await page.goto('https://lorabaygolf.clubhouseonline-e3.com/login.aspx');
  const username = process.env.GOLF_USERNAME;
  const password = process.env.GOLF_PASSWORD;

  if (!username || !password) {
    throw new Error('Golf course credentials not found in environment variables');
  }

  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
}

async function findAvailableTeeSlots(page: Page, timeRange: TimeRange): Promise<Array<{ time: string; id: string; sortableTime: string }>> {
  return page.evaluate(({ startHour, endHour }) => {
    const slots: Array<{ time: string; id: string; sortableTime: string }> = [];
    let slotIdCounter = 0;

    // Helper function to parse time like "7:00 AM" or "12:30 PM" to HH:MM (24-hour) and hour number
    const parseTime = (timeStrWithAmPm: string): { hour: number; minute: number; formattedTime: string } | null => {
      const timeMatch = timeStrWithAmPm.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!timeMatch) return null;

      let hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3].toUpperCase();

      if (ampm === 'PM' && hour !== 12) {
        hour += 12;
      } else if (ampm === 'AM' && hour === 12) { // 12 AM is 00 hours
        hour = 0;
      }
      // 12 PM is 12 hours, no change needed. Other AM hours are also fine.
      
      return { 
          hour, 
          minute, 
          formattedTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` 
      };
    };

    const flexRows = document.querySelectorAll('div.flex-row.ng-scope');
    flexRows.forEach((row) => {
      if (row.classList.contains('unavailable')) {
        return; // Skip rows marked as unavailable
      }

      const availabilityDiv = row.querySelector('div.availability.ng-scope');
      if (availabilityDiv) {
        const valueStrong = availabilityDiv.querySelector('strong.value.ng-binding');
        // Check if there are exactly 4 available spots
        if (valueStrong && valueStrong.textContent && parseInt(valueStrong.textContent.trim(), 10) === 4) {
          const teeSheetLeftCol = row.querySelector('div.teesheet-leftcol.ng-scope');
          if (teeSheetLeftCol) {
            const timeDiv = teeSheetLeftCol.querySelector('div.time.ng-binding');
            if (timeDiv && timeDiv.textContent) {
              const fullText = timeDiv.textContent.trim();
              // Regex to extract time like "7:00 AM" from the end of the string
              const timeStrMatch = fullText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
              
              if (timeStrMatch && timeStrMatch[1]) {
                const parsedTimeDetails = parseTime(timeStrMatch[1]);
                if (parsedTimeDetails && parsedTimeDetails.hour >= startHour && parsedTimeDetails.hour <= endHour) {
                  const uniqueId = `playwright-slot-${slotIdCounter++}`;
                  if (timeDiv instanceof HTMLElement) {
                       timeDiv.setAttribute('data-playwright-id', uniqueId);
                  }
                 
                  slots.push({ 
                      time: parsedTimeDetails.formattedTime, // e.g., "07:00" or "13:00"
                      id: uniqueId,
                      sortableTime: parsedTimeDetails.formattedTime 
                  });
                }
              }
            }
          }
        }
      }
    });
    return slots;
  }, { startHour: timeRange.start, endHour: timeRange.end });
}


async function processSingleRequest(page: Page, request: BookingRequest): Promise<{ message: string; success: boolean }> {
  try {
    log(`Processing request ${request.id} for ${request.playDate}`);
    // Assuming navigateToBookingPage (called in processRealRequests) has already brought us to the correct page.
    // Removed: await page.goto('https://yourgolfcourse.com/book-tee-time'); 

    // Parse playDate (YYYY-MM-DD) and format to "Mon DD" (e.g., "Jul 12")
    const parts = request.playDate.split('-');
    if (parts.length !== 3) {
      throw new Error(`Invalid date format: ${request.playDate}. Expected YYYY-MM-DD.`);
    }
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed in Date constructor
    const day = parseInt(parts[2], 10);
    const playDateObj = new Date(year, month, day);

    if (isNaN(playDateObj.getTime())) {
      request.status = 'error';
      request.processedDate = new Date().toISOString();
      request.failureReason = `Invalid date in request: ${request.playDate}`;
      log(`ERROR: Invalid date in request ${request.id}: ${request.playDate}`);
      return { message: `⚠️ Request ${request.id}: Invalid date ${request.playDate}\n`, success: false };
    }

    const targetMonth = playDateObj.toLocaleString('en-US', { month: 'short' });
    const targetDay = playDateObj.getDate();
    const targetDateText = `${targetMonth} ${targetDay}`;
    log(`Attempting to select date: "${targetDateText}" for playDate ${request.playDate}`);

    const dateClicked = await page.evaluate((dateText) => {
      const dateElements = document.querySelectorAll('div.item.ng-scope.slick-slide');
      for (const el of dateElements) {
        const dateDiv = el.querySelector('div.date.ng-binding');
        if (dateDiv && dateDiv.textContent && dateDiv.textContent.trim().includes(dateText)) {
          if (el instanceof HTMLElement) {
            el.click();
            return true;
          }
        }
      }
      return false; // Not found
    }, targetDateText);

    if (!dateClicked) {
      log(`ERROR: Could not find or click date element for "${targetDateText}" for request ${request.id}`);
      request.status = 'failed';
      request.processedDate = new Date().toISOString();
      request.failureReason = `Could not select date "${targetDateText}" on the booking page.`;
      return {
        message: `❌ Request ${request.id}: Failed to select date "${targetDateText}"\n`,
        success: false,
      };
    }

    log(`Successfully clicked date: "${targetDateText}" for request ${request.id}`);
    // Wait for UI to update after date selection. Consider replacing with a more specific wait
    // (e.g., waiting for available time slots to load or a loading indicator to disappear).
    await page.waitForTimeout(3000); // Increased timeout slightly for safety, adjust as needed

    const availableTimes = await findAvailableTeeSlots(page, request.timeRange);


    if (availableTimes.length === 0) {
      request.status = 'failed';
      request.processedDate = new Date().toISOString();
      request.failureReason = 'No available times in specified range with 4 spots.';
      log(`INFO: No available tee times found for request ${request.id} between ${request.timeRange.start}:00 and ${request.timeRange.end}:00 with 4 spots.`);
      return {
        message: `❌ Request ${request.id}: No available times between ${request.timeRange.start}:00 and ${request.timeRange.end}:00 with 4 spots.\n`,
        success: false
      };
    }

    if (availableTimes.length > 0) {
      availableTimes.sort((a, b) => a.sortableTime.localeCompare(b.sortableTime));
      
      const selectedSlot = availableTimes[0];
      log(`Found ${availableTimes.length} available slot(s) with 4 spots. Attempting to book: ${selectedSlot.time} using id ${selectedSlot.id}`);

      await page.click(`[data-playwright-id="${selectedSlot.id}"]`);
      await confirmBookingPage(page);

      // const confirmationNumber = await page.evaluate(() => {
      //   const element = document.querySelector('.confirmation-number');
      //   return element ? element.textContent || '' : '';
      // });

      request.status = 'success';
      request.processedDate = new Date().toISOString();
      request.bookedTime = selectedSlot.time;
      request.confirmationNumber = "TEST";

      return {
        message: `✅ Request ${request.id}: Booked for ${selectedSlot.time} (Confirmation: ${request.confirmationNumber})\n`,
        success: true
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

  // Fallback return in case no other return was hit (should not happen)
  return {
    message: `⚠️ Request ${request.id}: Unknown error occurred\n`,
    success: false
  };
}

const confirmBookingPage = async (page: Page): Promise<void> => {
  log('Confirming booking');
  await page.getByText('ADD BUDDIES & GROUPS').click();
  await page.getByText('Test group (3 people)').click();
  await page.getByText('BOOK NOW').waitFor({ timeout: 10000 }).catch(() => {
      log('WARNING: Could not detect navigation success indicator (BOOK NOW button)');
  });
  //await page.getByText('BOOK NOW').click();
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