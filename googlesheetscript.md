
function syncGoogleSheetToSupabase() {
  // === Configuration ===
  const supabaseUrl = 'https://wrrwcfcicjckpcgqyqau.supabase.co'; // Replace with your Supabase URL
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndycndjZmNpY2pja3BjZ3F5cWF1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyNjgzMTYwNiwiZXhwIjoyMDQyNDA3NjA2fQ.hEwbOHDOqwsgNyyWKnLGTOlI6YwmFlRjhsGYv83mkqY'; // Securely retrieved
  const tableName = 'orderin'; // Your Supabase table name
  const rpcFunctionName = 'truncate_orderin'; // Your RPC function name
  const notificationEmail = 'Kamaljeet@prayagindia.com'; // Your email for notifications
  const batchSize = 100; // Number of records per batch
  const maxRetries = 3; // Maximum number of retries per batch
  // =====================
  
  // === Retrieve Data from Google Sheets ===
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const dataRange = sheet.getDataRange();
  const dataValues = dataRange.getValues();
  
  if (dataValues.length < 2) {
    Logger.log('No data found in the sheet.');
    MailApp.sendEmail(notificationEmail, 'Supabase Sync Alert', 'ORDER No data found in the Google Sheet to upload.');
    return;
  }
  
  // Separate headers and data rows
  let [headers, ...dataRows] = dataValues;
  
  // Remove 'id' column if it exists (since it's not present in Supabase table)
  const idIndex = headers.indexOf('id');
  if (idIndex !== -1) {
    headers.splice(idIndex, 1);
    dataRows = dataRows.map(row => {
      row.splice(idIndex, 1);
      return row;
    });
  }
  
  // Convert headers to lowercase and trim to match Supabase column names
  headers = headers.map(header => header.toLowerCase().trim());
  
  // Validate that required columns exist
  const requiredColumns = ['types']; // Add other required columns if any
  for (let col of requiredColumns) {
    if (!headers.includes(col)) {
      Logger.log(`'${col}' column not found in the sheet.`);
      MailApp.sendEmail(notificationEmail, 'Supabase Sync Error', `'${col}' ORDER column not found in the Google Sheet. Please ensure it exists.`);
      return;
    }
  }
  
  // Define date columns
  const dateColumns = ['date']; // Add other date columns if any
  
  // Convert data rows to JSON objects with formatted dates and order_index
  const dataToUpload = dataRows.map((row, rowIndex) => {
    const obj = { order_index: rowIndex + 1 }; // Assign order_index based on row position
    headers.forEach((header, index) => {
      let value = row[index];
      
      // Check if the current column is a date column
      if (dateColumns.includes(header)) {
        if (value instanceof Date) {
          // Format date as 'YYYY-MM-DD'
          value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else if (typeof value === 'string') {
          // Attempt to parse and format if it's a string
          const parsedDate = new Date(value);
          if (!isNaN(parsedDate)) {
            value = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          } else {
            // If parsing fails, set to null or handle accordingly
            value = null;
          }
        } else {
          // If value is not a Date or string, set to null or handle accordingly
          value = null;
        }
      }
      
      obj[header] = value;
    });
    return obj;
  }).filter(obj => obj.types); // Ensure 'types' is present
  
  if (dataToUpload.length === 0) {
    Logger.log('No valid data to upload after processing.');
    MailApp.sendEmail(notificationEmail, 'Supabase Sync Alert', 'ORDER No valid data to upload after processing the Google Sheet.');
    return;
  }
  
  // Log data for debugging
  Logger.log('Total Records to Upload: ' + dataToUpload.length);
  
  // === Truncate Supabase Table ===
  const truncateSuccess = truncateSupabaseTable(supabaseUrl, supabaseKey, rpcFunctionName, notificationEmail);
  if (!truncateSuccess) {
    Logger.log('Aborting upload due to truncation failure.');
    return; // Exit the function if truncation fails
  }
  
  // === Upload Data in Batches ===
  const batches = splitIntoBatches(dataToUpload, batchSize);
  let allBatchesSuccess = true;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let success = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      Logger.log(`Uploading batch ${i + 1} of ${batches.length}, Attempt ${attempt}`);
      success = uploadDataToSupabaseTable(supabaseUrl, supabaseKey, tableName, batch, notificationEmail);
      
      if (success) {
        Logger.log(`Batch ${i + 1} uploaded successfully.`);
        break; // Exit retry loop on success
      } else {
        Logger.log(`Batch ${i + 1} failed on attempt ${attempt}.`);
        if (attempt < maxRetries) {
          Logger.log('Retrying...');
          Utilities.sleep(2000); // Wait for 2 seconds before retrying
        }
      }
    }
    
    if (!success) {
      Logger.log(`Batch ${i + 1} failed after ${maxRetries} attempts.`);
      MailApp.sendEmail(notificationEmail, 'Order Supabase Upload Error', `ORDER There was an error uploading batch ${i + 1} to Supabase after ${maxRetries} attempts.`);
      allBatchesSuccess = false;
      // Decide whether to continue with next batches or abort
      // For this example, we'll abort
      break;
    }
  }
  
  if (allBatchesSuccess) {
    Logger.log('All batches uploaded successfully.');
    
  } else {
    Logger.log('Some batches failed to upload.');
    
  }
}

/**
 * Splits an array into smaller batches.
 * @param {Array} data - The data array to split.
 * @param {number} batchSize - The size of each batch.
 * @returns {Array<Array>} - An array of batches.
 */
function splitIntoBatches(data, batchSize) {
  const batches = [];
  for (let i = 0; i < data.length; i += batchSize) {
    batches.push(data.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Truncates the specified Supabase table using an RPC function.
 * @param {string} supabaseUrl - The Supabase project URL.
 * @param {string} supabaseKey - The Supabase API key.
 * @param {string} rpcFunctionName - The name of the RPC function to call.
 * @param {string} notificationEmail - The email to send notifications to.
 * @returns {boolean} - Returns true if truncation was successful, else false.
 */
function truncateSupabaseTable(supabaseUrl, supabaseKey, rpcFunctionName, notificationEmail) {
  // Construct the RPC endpoint URL
  const url = `${supabaseUrl}/rest/v1/rpc/${rpcFunctionName}`;
  
  const options = {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    Logger.log('RPC Response Code: ' + responseCode);
    Logger.log('RPC Response Body: ' + responseBody);
    
    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Order Table successfully truncated.');
      
      return true;
    } else {
      Logger.log('Error truncating table: ' + responseBody);
      
      return false;
    }
  } catch (e) {
    Logger.log('Exception during RPC: ' + e);
    
    return false;
  }
}

/**
 * Uploads data to the specified Supabase table.
 * @param {string} supabaseUrl - The Supabase project URL.
 * @param {string} supabaseKey - The Supabase API key.
 * @param {string} tableName - The name of the table to upload data to.
 * @param {Array<Object>} dataToUpload - The data to upload as an array of objects.
 * @param {string} notificationEmail - The email to send notifications to.
 * @returns {boolean} - Returns true if upload was successful, else false.
 */
function uploadDataToSupabaseTable(supabaseUrl, supabaseKey, tableName, dataToUpload, notificationEmail) {
  // === Configure the POST request ===
  const url = `${supabaseUrl}/rest/v1/${tableName}`;
  
  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(dataToUpload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    Logger.log('POST Response Code: ' + responseCode);
    Logger.log('POST Response Body: ' + responseBody);
    
    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Order Data successfully uploaded to Supabase.');
      // Note: To reduce the number of emails, you can choose to send emails only on failures
      // MailApp.sendEmail(notificationEmail, 'Supabase Upload Success', 'Data has been successfully uploaded to Supabase.');
      return true;
    } else {
      Logger.log('Error uploading data: ' + responseBody);
      MailApp.sendEmail(notificationEmail, 'Order Supabase Upload Error', 'ORDER There was an error uploading data to Supabase:\n' + responseBody);
      return false;
    }
  } catch (e) {
    Logger.log('Exception during POST: ' + e);
    MailApp.sendEmail(notificationEmail, 'Order Supabase Upload Exception', 'ORDER An exception occurred while uploading data to Supabase:\n' + e);
    return false;
  }
}

