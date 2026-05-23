import { Router } from "express";
import {
  addJournalRow,
  askJournal,
  createJournal,
  deleteJournal,
  generateAiCell,
  getDefaultJournal,
  getJournal,
  importSignalPlays,
  listJournals,
  updateJournal,
  updateJournalRow,
} from "../controllers/journal.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/", verifyToken, listJournals);
router.post("/", verifyToken, createJournal);
router.get("/default", verifyToken, getDefaultJournal);
router.get("/:journalId", verifyToken, getJournal);
router.patch("/:journalId", verifyToken, updateJournal);
router.delete("/:journalId", verifyToken, deleteJournal);
router.post("/:journalId/import-signal-plays", verifyToken, importSignalPlays);
router.post("/:journalId/ask", verifyToken, askJournal);
router.post("/:journalId/rows", verifyToken, addJournalRow);
router.patch("/:journalId/rows/:rowId", verifyToken, updateJournalRow);
router.post("/:journalId/rows/:rowId/ai", verifyToken, generateAiCell);

export default router;
