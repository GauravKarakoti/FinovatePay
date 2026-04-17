// Import your pre-configured API instance (adjust the relative path if needed)
import api from '../../utils/api';

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

    try {
      // USE the custom 'api' instance instead of native fetch. 
      // It automatically attaches the Authorization Bearer token!
      const response = await api.post('/chatbot', { 
        message, 
        history 
      });
      
      // Axios stores the JSON response inside the `.data` property
      const data = response.data;

      const botMessage = this.createChatBotMessage(data.reply);
      this.addMessageToState(botMessage);

    } catch (error) {
      console.error("Chatbot API Error:", error);
      const errorMessage = this.createChatBotMessage(
        "Sorry, I encountered an error. Please try again."
      );
      this.addMessageToState(errorMessage);
    }
  };

  addMessageToState = (message) => {
    this.setState((prevState) => ({
      ...prevState,
      messages: [...prevState.messages, message],
    }));
  };
}

export default ActionProvider;