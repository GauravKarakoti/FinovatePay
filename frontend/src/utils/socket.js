import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:3000", {
  withCredentials: true,
});

export default socket;
