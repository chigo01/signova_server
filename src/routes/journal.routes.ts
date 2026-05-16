import { Router } from "express";
import {
  addJournalRow,
  createJournal,
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
router.post("/:journalId/import-signal-plays", verifyToken, importSignalPlays);
router.post("/:journalId/rows", verifyToken, addJournalRow);
router.patch("/:journalId/rows/:rowId", verifyToken, updateJournalRow);

export default router;
