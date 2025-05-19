document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const dateInput = document.getElementById('date');
    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');
    const tokenInput = document.getElementById('token');
    const bookButton = document.getElementById('bookButton');
    const statusMessage = document.getElementById('statusMessage');
    const refreshQueueButton = document.getElementById('refreshQueueButton');
    const queueDataContainer = document.getElementById('queueData');
    const settingsButton = document.getElementById('settingsButton');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsButton = document.querySelector('.close');
    const saveSettingsButton = document.getElementById('saveSettingsButton');
    const repoOwnerInput = document.getElementById('repoOwner');
    const repoNameInput = document.getElementById('repoName');
    
    // Set default date to 30 days from today
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30);
    dateInput.valueAsDate = defaultDate;
    
    // Auto-detect GitHub repository information from URL (for GitHub Pages)
    autoDetectRepoInfo();
    
    // Load saved data from localStorage
    loadSavedData();
    
    // Event listeners
    bookButton.addEventListener('click', bookTeeTime);
    refreshQueueButton.addEventListener('click', fetchBookingQueue);
    settingsButton.addEventListener('click', openSettings);
    closeSettingsButton.addEventListener('click', closeSettings);
    saveSettingsButton.addEventListener('click', saveSettings);
    
    // Add event delegation for delete buttons
    queueDataContainer.addEventListener('click', function(event) {
        if (event.target.classList.contains('delete-button')) {
            const requestId = event.target.getAttribute('data-id');
            deleteQueueItem(requestId);
        }
    });
    
    // Close modal if clicking outside of it
    window.addEventListener('click', function(event) {
        if (event.target == settingsModal) {
            closeSettings();
        }
    });
    
    // Initialize by fetching the queue
    fetchBookingQueue();
    
    // Functions
    function autoDetectRepoInfo() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        
        // Check if we're on GitHub Pages
        if (hostname.endsWith('github.io')) {
            // Extract username from github.io subdomain (username.github.io)
            const usernameMatch = hostname.match(/^([^.]+)\.github\.io$/);
            
            if (usernameMatch && usernameMatch[1]) {
                const username = usernameMatch[1];
                
                // For user sites (username.github.io), the repo name is usually the username.github.io
                if (pathname === '/' || pathname.startsWith('/index.html')) {
                    localStorage.setItem('repoOwner', username);
                    localStorage.setItem('repoName', `${username}.github.io`);
                    console.log(`Detected user GitHub Pages: ${username}/${username}.github.io`);
                    return;
                }
                
                // For project sites (username.github.io/repo-name/), extract the repo name from the path
                const projectMatch = pathname.match(/^\/([^\/]+)/);
                if (projectMatch && projectMatch[1]) {
                    const repoName = projectMatch[1];
                    localStorage.setItem('repoOwner', username);
                    localStorage.setItem('repoName', repoName);
                    console.log(`Detected project GitHub Pages: ${username}/${repoName}`);
                    return;
                }
            }
        }
        
        // If we can't auto-detect, we'll fall back to the stored values or manual entry
        console.log('Could not auto-detect GitHub repository information from URL');
    }
    
    function loadSavedData() {
        // Load token
        const savedToken = localStorage.getItem('githubToken');
        if (savedToken) {
            tokenInput.value = savedToken;
        }
        
        // Load repository info
        const repoOwner = localStorage.getItem('repoOwner');
        const repoName = localStorage.getItem('repoName');
        
        if (repoOwner) {
            repoOwnerInput.value = repoOwner;
        }
        
        if (repoName) {
            repoNameInput.value = repoName;
        }
    }
    
    function getRepoInfo() {
        let repoOwner = localStorage.getItem('repoOwner');
        let repoName = localStorage.getItem('repoName');
        
        // Default values if not set
        if (!repoOwner || !repoName) {
            // Check if we can auto-detect from URL
            autoDetectRepoInfo();
            
            // Try again after auto-detect
            repoOwner = localStorage.getItem('repoOwner');
            repoName = localStorage.getItem('repoName');
            
            if (!repoOwner || !repoName) {
                showStatus('Repository info auto-detection failed. Please set repository information in Settings', 'error');
                openSettings();
                return null;
            } else {
                showStatus(`Using detected repository: ${repoOwner}/${repoName}`, 'info');
            }
        }
        
        return { owner: repoOwner, name: repoName };
    }
    
    async function bookTeeTime() {
        const date = dateInput.value;
        const startTime = startTimeInput.value; // Keep as string HH:MM
        const endTime = endTimeInput.value;   // Keep as string HH:MM
        const token = tokenInput.value;
        
        // Basic validation
        if (!date || !startTime || !endTime || !token) {
            showStatus('Please fill in all fields.', 'error');
            return;
        }
        
        // Convert HH:MM to minutes for comparison
        const startTimeInMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
        const endTimeInMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);

        if (startTimeInMinutes >= endTimeInMinutes) {
            showStatus('End time must be after start time.', 'error');
            return;
        }
        
        const repoInfo = getRepoInfo();
        if (!repoInfo) return;
        
        // Save token to localStorage for convenience
        localStorage.setItem('githubToken', token);
        
        // Show loading status
        showStatus('Adding booking request to queue... Please wait.', 'info');
        bookButton.disabled = true;
        bookButton.textContent = 'Processing...';
        
        try {
            // First, get the current booking queue file
            const getQueueResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/contents/booking-queue.json`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            let queueData;
            let sha;
            
            if (getQueueResponse.status === 200) {
                // File exists, get its content and SHA
                const fileData = await getQueueResponse.json();
                sha = fileData.sha;
                const content = atob(fileData.content);
                queueData = JSON.parse(content);
            } else if (getQueueResponse.status === 404) {
                // File doesn't exist yet, create initial structure
                queueData = {
                    "bookingRequests": [],
                    "processedRequests": []
                };
            } else {
                const errorData = await getQueueResponse.json();
                throw new Error(`API responded with status ${getQueueResponse.status}: ${errorData.message}`);
            }
            
            // Create a new booking request
            const requestId = `${new Date().toISOString().slice(0, 10)}-${Math.floor(Math.random() * 100000)}`;
            const newRequest = {
                "id": requestId,
                "requestDate": new Date().toISOString(),
                "playDate": date,
                "timeRange": {
                    "start": startTime, // Store as HH:MM string
                    "end": endTime      // Store as HH:MM string
                },
                "status": "pending"
            };
            
            // Add to queue
            queueData.bookingRequests.push(newRequest);
            
            // Create commit to update the file
            const updateResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/contents/booking-queue.json`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Add booking request for ${date}`,
                    content: btoa(JSON.stringify(queueData, null, 2)),
                    sha: sha
                })
            });
            
            if (updateResponse.status === 200 || updateResponse.status === 201) {
                showStatus(`Successfully added booking request for ${date} to the queue! Check Discord for updates when it processes.`, 'success');
                // Refresh the queue display
                fetchBookingQueue();
            } else {
                const errorData = await updateResponse.json();
                throw new Error(`API responded with status ${updateResponse.status}: ${errorData.message}`);
            }
        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
            console.error(error);
        } finally {
            bookButton.disabled = false;
            bookButton.textContent = 'Book Tee Time';
        }
    }
    
    async function fetchBookingQueue() {
        const token = tokenInput.value;
        if (!token) {
            queueDataContainer.innerHTML = '<p>Please enter your Booking Password to view the queue.</p>';
            return;
        }
        
        const repoInfo = getRepoInfo();
        if (!repoInfo) return;
        
        refreshQueueButton.disabled = true;
        refreshQueueButton.textContent = 'Loading...';
        
        try {
            const response = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/contents/booking-queue.json`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.status === 200) {
                const fileData = await response.json();
                const content = atob(fileData.content);
                const queueData = JSON.parse(content);
                
                displayQueueData(queueData);
            } else if (response.status === 404) {
                queueDataContainer.innerHTML = '<p>No booking queue found in the repository.</p>';
            } else {
                const errorData = await response.json();
                queueDataContainer.innerHTML = `<p>Error fetching queue: ${errorData.message}</p>`;
            }
        } catch (error) {
            queueDataContainer.innerHTML = `<p>Error: ${error.message}</p>`;
            console.error(error);
        } finally {
            refreshQueueButton.disabled = false;
            refreshQueueButton.textContent = 'Refresh Queue';
        }
    }
    
    function displayQueueData(queueData) {
        const pendingRequests = queueData.bookingRequests || [];
        const processedRequests = queueData.processedRequests || [];
        
        let html = '';
        
        if (pendingRequests.length === 0 && processedRequests.length === 0) {
            html = '<p>No booking requests in the queue.</p>';
        } else {
            html = '<h3>Pending Requests</h3>';
            
            if (pendingRequests.length === 0) {
                html += '<p>No pending requests.</p>';
            } else {
                pendingRequests.forEach(request => {
                    html += `
                        <div class="queue-item pending">
                            <button class="delete-button" data-id="${request.id}">×</button>
                            <h3>${formatDate(request.playDate)}</h3>
                            <p><span class="label">Time Range:</span> ${request.timeRange.start}:00 - ${request.timeRange.end}:00</p>
                            <p><span class="label">Status:</span> Pending</p>
                            <p><span class="label">Requested:</span> ${formatDateTime(request.requestDate)}</p>
                        </div>
                    `;
                });
            }
            
            html += '<h3>Processed Requests</h3>';
            
            if (processedRequests.length === 0) {
                html += '<p>No processed requests.</p>';
            } else {
                // Sort by processed date, most recent first
                const sortedRequests = [...processedRequests].sort((a, b) => {
                    return new Date(b.processedDate) - new Date(a.processedDate);
                });
                
                // Only show the last 5 processed requests
                sortedRequests.slice(0, 5).forEach(request => {
                    let statusText = '';
                    let statusClass = '';
                    
                    switch (request.status) {
                        case 'success':
                            statusText = `Booked for ${request.bookedTime}`;
                            statusClass = 'success';
                            break;
                        case 'failed':
                            statusText = `Failed: ${request.failureReason || 'No available times'}`;
                            statusClass = 'failed';
                            break;
                        case 'error':
                            statusText = `Error: ${request.failureReason || 'Unknown error'}`;
                            statusClass = 'error';
                            break;
                        default:
                            statusText = request.status;
                            statusClass = '';
                    }
                    
                    html += `
                        <div class="queue-item ${statusClass}">
                            <h3>${formatDate(request.playDate)}</h3>
                            <p><span class="label">Time Range:</span> ${request.timeRange.start}:00 - ${request.timeRange.end}:00</p>
                            <p><span class="label">Status:</span> ${statusText}</p>
                            <p><span class="label">Processed:</span> ${formatDateTime(request.processedDate)}</p>
                            ${request.confirmationNumber ? `<p><span class="label">Confirmation:</span> ${request.confirmationNumber}</p>` : ''}
                        </div>
                    `;
                });
                
                if (sortedRequests.length > 5) {
                    html += `<p>Showing 5 of ${sortedRequests.length} processed requests.</p>`;
                }
            }
        }
        
        queueDataContainer.innerHTML = html;
    }
    
    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status ${type}`;
        statusMessage.style.display = 'block';
        
        // Scroll to the status message
        statusMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    function openSettings() {
        settingsModal.style.display = 'block';
    }
    
    function closeSettings() {
        settingsModal.style.display = 'none';
    }
    
    function saveSettings() {
        const repoOwner = repoOwnerInput.value.trim();
        const repoName = repoNameInput.value.trim();
        
        if (!repoOwner || !repoName) {
            alert('Please enter both repository owner and name.');
            return;
        }
        
        localStorage.setItem('repoOwner', repoOwner);
        localStorage.setItem('repoName', repoName);
        
        closeSettings();
        showStatus('Settings saved successfully!', 'success');
        
        // Refresh the queue with new settings
        fetchBookingQueue();
    }
    
    function formatDate(dateString) {
        if (!dateString) return 'Unknown';
        
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    }
    
    function formatDateTime(dateTimeString) {
        if (!dateTimeString) return 'Unknown';
        
        const date = new Date(dateTimeString);
        return date.toLocaleString();
    }
    
    async function deleteQueueItem(requestId) {
        const token = tokenInput.value;
        if (!token) {
            showStatus('Please enter your Booking Password to delete items.', 'error');
            return;
        }
        
        const repoInfo = getRepoInfo();
        if (!repoInfo) return;
        
        showStatus('Deleting request... Please wait.', 'info');
        
        try {
            // First, get the current booking queue file
            const getQueueResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/contents/booking-queue.json`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (getQueueResponse.status !== 200) {
                const errorData = await getQueueResponse.json();
                throw new Error(`API responded with status ${getQueueResponse.status}: ${errorData.message}`);
            }
            
            // Get file content and SHA
            const fileData = await getQueueResponse.json();
            const sha = fileData.sha;
            const content = atob(fileData.content);
            const queueData = JSON.parse(content);
            
            // Find and remove the item with the matching ID
            const index = queueData.bookingRequests.findIndex(request => request.id === requestId);
            
            if (index === -1) {
                throw new Error(`Request with ID ${requestId} not found in the queue.`);
            }
            
            // Remove the item from the array
            queueData.bookingRequests.splice(index, 1);
            
            // Create commit to update the file
            const updateResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/contents/booking-queue.json`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Delete booking request ${requestId}`,
                    content: btoa(JSON.stringify(queueData, null, 2)),
                    sha: sha
                })
            });
            
            if (updateResponse.status === 200 || updateResponse.status === 201) {
                showStatus('Successfully removed the booking request from the queue!', 'success');
                // Refresh the queue display
                fetchBookingQueue();
            } else {
                const errorData = await updateResponse.json();
                throw new Error(`API responded with status ${updateResponse.status}: ${errorData.message}`);
            }
        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }
});