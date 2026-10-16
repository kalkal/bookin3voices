// Contratti della generazione outline (Fase 2):
// input della callable validato con Zod al confine, output di Gemini MAI
// fidato (parse, don't validate) e interfaccia `OutlineModel` in stile
// Strategy/AiProvider — la callable è un orchestratore sottile, il modello
// vero (ProviderModel) si inietta e nei test si sostituisce con un fake.

import { z } from 'zod';

import type { OutlinePrompt } from './outlinePrompt';

/**
 * Un capitolo proposto dalla scaletta: titolo, riassunto e beat principali
 * (Fase 2). I limiti servono da guardrail sull'output del modello:
 * un outline fuori misura è un output non conforme, non un dato da salvare.
 */
export const outlineChapterSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  beats: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
});

export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

export const outlineSchema = z.object({
  chapters: z.array(outlineChapterSchema).min(1).max(60),
});

export type Outline = z.infer<typeof outlineSchema>;

/**
 * Input della callable `generateOutline`. Il requestId è la chiave di
 * idempotenza e diventa l'id del documento
 * `users/{uid}/outlines/{requestId}`: stesso formato ristretto di exportBook.
 * La sinossi viaggia come parametro (può differire da quella salvata sul
 * libro mentre l'utente la sta ancora ritoccando).
 */
export const generateOutlineInputSchema = z.object({
  bookId: z.string().min(1),
  synopsis: z.string().trim().min(1).max(20_000),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export type GenerateOutlineInput = z.infer<typeof generateOutlineInputSchema>;

/**
 * Campi del documento libro che servono al prompt (contesto per il modello).
 * Subset dello schema, come fa l'export.
 */
export const bookForOutlineSchema = z.object({
  title: z.string(),
  genre: z.string(),
  language: z.string(),
});

export type BookForOutline = z.infer<typeof bookForOutlineSchema>;

/**
 * Campi del documento capitolo che servono alla generazione: i capitoli con
 * `rawText` non vuoto sono INTOCCABILI e entrano nel prompt solo
 * come contesto "già scritto, non riproporre".
 */
export const chapterForOutlineSchema = z.object({
  order: z.number(),
  title: z.string(),
  rawText: z.string(),
});

/**
 * Registro di idempotenza su `users/{uid}/outlines/{requestId}`: un retry di
 * rete con lo stesso requestId riusa l'outline già generato (stessa risposta,
 * nessuna seconda chiamata a Gemini). Collezione scritta solo dall'admin SDK:
 * le security rules la lasciano negata al client (fail-closed).
 */
export const outlineRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string(),
  model: z.string(),
  promptVersion: z.number().int().positive(),
  outline: outlineSchema,
  createdAt: z.number(),
});

export type OutlineRegistryDoc = z.infer<typeof outlineRegistryDocSchema>;

/** Risposta della callable: la scaletta proposta, MAI salvata sui capitoli — la conferma (e il merge additivo) è dell'app. */
export interface GenerateOutlineResponse {
  requestId: string;
  bookId: string;
  model: string;
  promptVersion: number;
  createdAt: number;
  chapters: OutlineChapter[];
}

/**
 * Il modello che genera la scaletta (Strategy `AiProvider`):
 * riceve il prompt già costruito e restituisce il JSON del modello ANCORA da
 * validare — la validazione Zod resta alla callable, che è il confine.
 */
export interface OutlineModel {
  readonly modelName: string;
  generate(prompt: OutlinePrompt): Promise<unknown>;
}
