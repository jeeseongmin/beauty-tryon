import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Hair from "./pages/Hair";
import Nail from "./pages/Nail";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/hair" element={<Hair />} />
        <Route path="/nail" element={<Nail />} />
      </Routes>
    </div>
  );
}
