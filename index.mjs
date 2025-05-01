// Import necessary modules
import express from 'express';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { OpenAIApi, Configuration } from 'openai-edge';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve the index.html file when accessing the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Initialize the OpenAI client with openai-edge
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

/**
 * Endpoint: /query
 * Method: POST
 * Description:
 *   - Accepts a table name and a natural language query from the user.
 *   - Uses OpenAI to convert the natural language query into an SQL statement.
 *   - Executes the SQL statement against the Supabase database.
 *   - Processes the retrieved data with OpenAI to generate a summarized and insightful report.
 *   - Returns the AI-processed result to the user.
 */
app.post('/query', async (req, res) => {
    const { table, naturalLanguageQuery } = req.body;

    if (!table || !naturalLanguageQuery) {
        return res.status(400).json({ error: 'Table name and natural language query are required' });
    }

    try {
        // Step 1: Generate the SQL query using the AI model
        const aiResponse = await openai.createChatCompletion({
             model: "o4-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an intelligent assistant that generates SQL queries based on user input and interacts with a Supabase database. Respond with only the SQL query and no additional text or formatting, such as backticks or code blocks. Do not put ; (semi-colon) at the end of the query. Ensure table and column names are wrapped in double quotes (e.g., "table_name") if given in table schema; otherwise, don't wrap. Here is the salein table schema: type, invoice_no, date, bill_from, customer_name, "group", item_code, color, quantity, mrp, sale_rate, amount, month, market_category. Here is the orderin table schema: types, date, customer, item_group, item_code, item_name, color, quantity, amount. Never show id and order_index columns in the result. Show table form accurately. If the user requests something related to creating reports or any other format, understand the user's intent and create it accordingly because you are a smart report creator and analyzer. Give your 100% to resolve user questions or queries. You can create multiple creative styles of reports for a better user experience.`
                },
                {
                    role: "user",
                    content: `Convert the following natural language description into an SQL query for the table "${table}": ${naturalLanguageQuery}`
                }
            ],
            response_format: {
    type: "text"
  },
           reasoning_effort: "medium",
  store: false
});

        // Step 2: Extract and clean the generated SQL
        const responseJson = await aiResponse.json();
        let generatedSQL = responseJson.choices[0].message.content.trim();

        // Remove unwanted characters and formatting
        generatedSQL = generatedSQL.replace(/```/g, '').replace(/^\s*SQL:\s*/i, '').trim();

        console.log("Cleaned SQL Query: ", generatedSQL);

        // Security Note:
        // Executing raw SQL queries can be dangerous and may lead to SQL injection.
        // Ensure that the 'execute_sql' function in Supabase is secure and properly sanitized.

        // Step 3: Execute the SQL query using Supabase's RPC function
        const { data, error } = await supabase.rpc('execute_sql', { sql_query: generatedSQL });

        if (error) {
            console.error('Supabase Error:', error.message, 'Details:', error.details);
            return res.status(500).json({ error: `Database query failed: ${error.message}` });
        }

        console.log('Query Result:', data);

        // Step 4: Process the data with AI for enhanced presentation
        const processResponse = await openai.createChatCompletion({
            model: "o4-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an intelligent assistant that can analyze and present data in a user-friendly manner. Format the data provided into a clear and concise report of this table "${table}" and please remember if table name is orderin so actual table name is Order & if table name is salein so actual table name is Sales Table, summarizing key insights and highlighting important information. Dont use star * or bold character like this **Key Insights:** or Dont use in any other words. Use indian currency sign where you want to show value Or amount value.`
                },
                {
                    role: "user",
                    content: `Here is the data from my database query:\n${JSON.stringify(data, null, 2)}\n\nPlease provide a summary and key insights based on this data.`
                }
            ],
            response_format: {
    type: "text"
  },
           reasoning_effort: "medium",
  store: false
});

        // Step 5: Extract the AI-processed response
        const processResponseJson = await processResponse.json();
        const aiProcessedResult = processResponseJson.choices[0].message.content.trim();

        // Optionally, log the processed result
        console.log("AI-Processed Result: ", aiProcessedResult);

        // Step 6: Send both raw data and AI-processed result to the user
        res.json({ data, aiResult: aiProcessedResult });

    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: 'An error occurred while processing the request' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
