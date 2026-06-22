import { Router } from "express";
import {
  deleteChartLayout,
  deleteChartTemplate,
  deleteDrawingTemplate,
  deleteStudyTemplate,
  getChartLayout,
  getChartTemplate,
  getDrawingTemplate,
  getStudyTemplate,
  listChartLayouts,
  listChartTemplates,
  listDrawingTemplates,
  listStudyTemplates,
  saveChartLayout,
  saveChartTemplate,
  saveDrawingTemplate,
  saveStudyTemplate,
} from "../controllers/chartPreset.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

// Chart layouts
router.get("/layouts", verifyToken, listChartLayouts);
router.post("/layouts", verifyToken, saveChartLayout);
router.get("/layouts/:id", verifyToken, getChartLayout);
router.delete("/layouts/:id", verifyToken, deleteChartLayout);

// Study templates (indicator sets)
router.get("/study-templates", verifyToken, listStudyTemplates);
router.post("/study-templates", verifyToken, saveStudyTemplate);
router.get("/study-templates/content", verifyToken, getStudyTemplate);
router.delete("/study-templates", verifyToken, deleteStudyTemplate);

// Drawing templates
router.get("/drawing-templates", verifyToken, listDrawingTemplates);
router.post("/drawing-templates", verifyToken, saveDrawingTemplate);
router.get("/drawing-templates/content", verifyToken, getDrawingTemplate);
router.delete("/drawing-templates", verifyToken, deleteDrawingTemplate);

// Chart templates (styling)
router.get("/chart-templates", verifyToken, listChartTemplates);
router.post("/chart-templates", verifyToken, saveChartTemplate);
router.get("/chart-templates/content", verifyToken, getChartTemplate);
router.delete("/chart-templates", verifyToken, deleteChartTemplate);

export default router;
