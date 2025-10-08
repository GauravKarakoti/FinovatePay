class ActionProvider {
  constructor(createChatBotMessage, setStateFunc) {
    this.createChatBotMessage = createChatBotMessage;
    this.setState = setStateFunc;
  }

  handleUserMessage = async (message, state) => {
    // Map the current messages from the state to the format Groq expects
    const history = state.messages.map(msg => ({
        role: msg.type === 'bot' ? 'assistant' : 'user',
        content: msg.message
    }));

    const response = await fetch(`${import.meta.env.VITE_API_URL}/chatbot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Send both the new message and the conversation history
      body: JSON.stringify({ message, history }),
    });
    const data = await response.json();

    const botMessage = this.createChatBotMessage(data.reply);
    this.addMessageToState(botMessage);
  };

  addMessageToState = (message) => {
    this.setState((prevState) => ({
      ...prevState,
      messages: [...prevState.messages, message],
    }));
  };
}

export default ActionProvider;