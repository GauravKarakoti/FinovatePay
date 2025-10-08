const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

router.post('/', async (req, res) => {
    // Destructure message and history, providing a default empty array for history.
    const { message, history = [] } = req.body; 
    console.log("Received message:", message);

    if (!message) {
        return res.status(400).json({ error: 'A message is required to chat.' });
    }

    try {
        // Construct the message payload for the Groq API
        const messages = [
            {
                role: "system",
                content: "You are a helpful and friendly assistant for FinovatePay, a B2B payment platform. Your goal is to answer user questions concisely about invoices, escrow, payments, and KYC. Be professional and clear in your responses. Reply in the language the person is talking in. If there is any other language but written in english alphabets, reply in that language but use english alphabets only."
            },
            // Safely include the previous conversation history
            ...history,
            {
                role: "user",
                content: message,
            },
        ];
        console.log("Sending messages to Groq API:", messages);

        // Call the Groq API to get a chat completion
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
        });

        const reply = chatCompletion.choices[0]?.message?.content || "Sorry, I couldn't process that request. Please try again.";
        console.log("Groq API reply:", reply);
        
        res.json({ reply });

    } catch (error) {
        console.error('Error communicating with Groq API:', error);
        res.status(500).json({ error: 'An error occurred while communicating with the AI assistant.' });
    }
});

module.exports = router;
