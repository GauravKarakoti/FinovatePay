const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Invoice = require('../models/Invoice'); // <-- ADDED
const pool = require('../config/database');   // <-- ADDED

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// --- NEW: Define the tools our AI agent can use ---
const tools = [
    {
        "type": "function",
        "function": {
            "name": "get_invoice_status",
            "description": "Get the current status of an invoice (e.g., Unpaid, Deposited, Released, Disputed).",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoiceId": {
                        "type": "string",
                        "description": "The unique ID of the invoice."
                    }
                },
                "required": ["invoiceId"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_shipment_location",
            "description": "Get the last known location of a produce lot or shipment.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lotId": {
                        "type": "string",
                        "description": "The ID of the produce lot."
                    }
                },
                "required": ["lotId"]
            }
        }
    },
    // Add more tools: e.g., propose_escrow_release, list_my_invoices
];

// --- NEW: Tool-calling logic ---
const availableTools = {
    // --- UPDATED: Real implementation ---
    "get_invoice_status": async ({ invoiceId }) => {
        try {
            console.log(`[AI Tool] Called get_invoice_status for: ${invoiceId}`);
            const invoice = await Invoice.findById(invoiceId); //
            
            if (!invoice) {
                return JSON.stringify({ status: "Not Found" });
            }
            
            // Return the actual escrow_status from the database
            return JSON.stringify({ status: invoice.escrow_status });

        } catch (error) {
            console.error(`[AI Tool Error] get_invoice_status:`, error.message);
            return JSON.stringify({ error: "Failed to retrieve invoice status." });
        }
    },
    // --- UPDATED: Real implementation ---
    "get_shipment_location": async ({ lotId }) => {
        try {
            console.log(`[AI Tool] Called get_shipment_location for: ${lotId}`);
            // Query the database for the produce lot's origin
            // Based on produceController.js, 'origin' is a field.
            const query = 'SELECT location FROM produce_location_history WHERE lot_id = $1 ORDER BY timestamp DESC LIMIT 1';
            const result = await pool.query(query, [lotId]);
            console.log(`[AI Tool] DB result for lot ${lotId}:`, result.rows);

            if (result.rows.length === 0) {
                return JSON.stringify({ location: "Lot Not Found" });
            }

            return JSON.stringify({ location: result.rows[0].location });
            
        } catch (error) {
            console.error(`[AI Tool Error] get_shipment_location:`, error.message);
            return JSON.stringify({ error: "Failed to retrieve shipment location." });
        }
    },
};

router.post('/', async (req, res) => {
    const { message, history = [] } = req.body;
    console.log("Received message:", message);

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const messages = [
            {
                role: "system",
                content: "You are a helpful and friendly assistant for FinovatePay, a B2B payment platform. Your goal is to answer user questions concisely about invoices, escrow, payments, and KYC. You can use tools to get real-time data. When asked about status or location, always use your tools. Be professional and clear in your responses."
            },
            ...history,
            { role: "user", content: message },
        ];

        // --- UPDATED: First API call to check for tool use ---
        const firstResponse = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
            tools: tools,
            tool_choice: "auto",
        });
        console.log("Groq API first response:", firstResponse.choices[0]);

        const responseMessage = firstResponse.choices[0].message;

        // Check if the model wants to call a tool
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            console.log("[AI Agent] Tool call requested:", responseMessage.tool_calls);
            
            // Add the assistant's tool request to the message history
            messages.push(responseMessage); 

            // Execute all requested tools
            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                
                const functionToCall = availableTools[functionName];
                const toolResponse = await functionToCall(functionArgs);

                // Add the tool's response to the message history
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResponse,
                });
            }
            console.log("[AI Agent] Completed tool calls, preparing final response.", messages);
            // --- NEW: Second API call to get a natural language response ---
            const finalResponse = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: messages,
            });
            console.log("Groq API final response:", finalResponse);

            const reply = finalResponse.choices[0]?.message?.content;
            console.log("Groq API final reply:", reply);
            res.json({ reply });

        } else {
            // No tool call needed, just a regular chat response
            const reply = responseMessage.content;
            console.log("Groq API simple reply:", reply);
            res.json({ reply });
        }

    } catch (error) {
        console.error('Error communicating with Groq API:', error);
        res.status(500).json({ error: 'An error occurred with the AI assistant.' });
    }
});

module.exports = router;