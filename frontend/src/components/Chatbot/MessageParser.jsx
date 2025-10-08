class MessageParser {
  constructor(actionProvider, state) {
    this.actionProvider = actionProvider;
    this.state = state;
  }

  parse(message) {
    // Pass the current message and the entire state to the action provider
    this.actionProvider.handleUserMessage(message, this.state);
  }
}

export default MessageParser;
