import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { EvaluationPage } from "./pages/EvaluationPage";
import { EditorPage } from "./pages/EditorPage";
import { LlmSettingsPage } from "./pages/LlmSettingsPage";
import { ReplayPage } from "./pages/ReplayPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/settings/llm" element={<LlmSettingsPage />} />
      <Route path="/boards/:boardId/edit" element={<EditorPage />} />
      <Route path="/boards/:boardId/evaluation" element={<EvaluationPage />} />
      <Route path="/boards/:boardId/replays/:recordingId" element={<ReplayPage />} />
    </Routes>
  );
}
