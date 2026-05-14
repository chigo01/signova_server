import { Router } from "express";
import {
  addJournalRow,
  getDefaultJournal,
  importSignalPlays,
  updateJournal,
  updateJournalRow,
} from "../controllers/journal.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/default", verifyToken, getDefaultJournal);
router.patch("/:journalId", verifyToken, updateJournal);
router.post("/:journalId/import-signal-plays", verifyToken, importSignalPlays);
router.post("/:journalId/rows", verifyToken, addJournalRow);
router.patch("/:journalId/rows/:rowId", verifyToken, updateJournalRow);

export default router;
