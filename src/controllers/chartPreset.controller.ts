import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { ChartPresetService } from "../services/chartPreset.service";

function ensureAuthenticatedUser(req: Request): string {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  return req.user.userId;
}

function requireQueryString(req: Request, key: string): string {
  const value = req.query[key];
  if (typeof value !== "string" || !value) {
    throw new AppError(400, `${key} query param is required`);
  }
  return value;
}

// ----- Chart layouts -----

export const listChartLayouts = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const layouts = await ChartPresetService.listChartLayouts(userId);
    res.status(200).json({ success: true, layouts });
  },
);

export const saveChartLayout = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const body = req.body ?? {};
    const id = await ChartPresetService.saveChartLayout(userId, {
      id: typeof body.id === "string" ? body.id : undefined,
      name: body.name,
      symbol: body.symbol,
      resolution: body.resolution,
      content: body.content,
    });
    res.status(200).json({ success: true, id });
  },
);

export const getChartLayout = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const content = await ChartPresetService.getChartLayoutContent(
      userId,
      req.params.id,
    );
    res.status(200).json({ success: true, content });
  },
);

export const deleteChartLayout = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    await ChartPresetService.removeChartLayout(userId, req.params.id);
    res.status(200).json({ success: true });
  },
);

// ----- Study templates -----

export const listStudyTemplates = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const templates = await ChartPresetService.listStudyTemplates(userId);
    res.status(200).json({ success: true, templates });
  },
);

export const saveStudyTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const body = req.body ?? {};
    await ChartPresetService.saveStudyTemplate(userId, body.name, body.content);
    res.status(200).json({ success: true });
  },
);

export const getStudyTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const name = requireQueryString(req, "name");
    const content = await ChartPresetService.getStudyTemplateContent(
      userId,
      name,
    );
    res.status(200).json({ success: true, content });
  },
);

export const deleteStudyTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const name = requireQueryString(req, "name");
    await ChartPresetService.removeStudyTemplate(userId, name);
    res.status(200).json({ success: true });
  },
);

export const getDefaultStudyTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const template = await ChartPresetService.getDefaultStudyTemplate(userId);
    res.status(200).json({ success: true, default: template });
  },
);

export const setDefaultStudyTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const name = req.body?.name;
    if (typeof name !== "string" || !name) {
      throw new AppError(400, "name is required");
    }
    await ChartPresetService.setDefaultStudyTemplate(userId, name);
    res.status(200).json({ success: true });
  },
);

// ----- Drawing templates -----

export const listDrawingTemplates = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const toolName = requireQueryString(req, "toolName");
    const names = await ChartPresetService.listDrawingTemplates(
      userId,
      toolName,
    );
    res.status(200).json({ success: true, names });
  },
);

export const saveDrawingTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const body = req.body ?? {};
    await ChartPresetService.saveDrawingTemplate(
      userId,
      body.toolName,
      body.name,
      body.content,
    );
    res.status(200).json({ success: true });
  },
);

export const getDrawingTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const toolName = requireQueryString(req, "toolName");
    const name = requireQueryString(req, "name");
    const content = await ChartPresetService.getDrawingTemplate(
      userId,
      toolName,
      name,
    );
    res.status(200).json({ success: true, content });
  },
);

export const deleteDrawingTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const toolName = requireQueryString(req, "toolName");
    const name = requireQueryString(req, "name");
    await ChartPresetService.removeDrawingTemplate(userId, toolName, name);
    res.status(200).json({ success: true });
  },
);

// ----- Chart templates (styling) -----

export const listChartTemplates = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const names = await ChartPresetService.listChartTemplates(userId);
    res.status(200).json({ success: true, names });
  },
);

export const saveChartTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const body = req.body ?? {};
    await ChartPresetService.saveChartTemplate(userId, body.name, body.content);
    res.status(200).json({ success: true });
  },
);

export const getChartTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const name = requireQueryString(req, "name");
    const content = await ChartPresetService.getChartTemplateContent(
      userId,
      name,
    );
    res.status(200).json({ success: true, content });
  },
);

export const deleteChartTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const name = requireQueryString(req, "name");
    await ChartPresetService.removeChartTemplate(userId, name);
    res.status(200).json({ success: true });
  },
);
