import { describe, expect, it } from 'vitest';
import envelopeSchema from '../schema/envelope.schema.json';
import {
  createEnvelope,
  isProtocolEnvelope,
  isTranslationScanReportPayload,
  isTranslationStartPayload,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
} from './index';

function schemaPayloadReference(messageType: string): string | undefined {
  for (const rawRule of envelopeSchema.allOf) {
    const rule = rawRule as {
      if?: { properties?: { type?: { const?: string; enum?: string[] } } };
      then?: { properties?: { payload?: { $ref?: string } } };
    };
    const matcher = rule.if?.properties?.type;
    if (matcher?.const === messageType || matcher?.enum?.includes(messageType) === true)
      return rule.then?.properties?.payload?.$ref;
  }
  return undefined;
}

function validTranslationStart() {
  return {
    taskId: '00000000-0000-4000-8000-000000000101',
    tabId: 1,
    frameId: 0,
    pageSessionId: '00000000-0000-4000-8000-000000000102',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    promptVersion: 'page-v2',
    domainId: 'domain-ai-ml',
    technicalTags: ['PyTorch', 'CUDA'],
    glossaryVersion: 0,
    translationMode: 'below',
    websiteRuleVersion: 1,
    segments: [
      {
        segmentId: 'segment-1',
        sourceText: 'A tensor is a multidimensional array.',
        sourceHash: 'source-hash-1',
        placeholders: [],
        priority: 0,
      },
    ],
    profile: { model: 'deepseek-v4-flash', thinking: 'disabled' },
  };
}

describe('protocol envelope', () => {
  it('creates a valid versioned envelope', () => {
    const envelope = createEnvelope('system.handshake.request', {
      extensionVersion: '0.1.0',
      supportedProtocolVersions: [1],
    });
    expect(envelope.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(isProtocolEnvelope(envelope)).toBe(true);
  });

  it('keeps the runtime message catalog identical to the JSON Schema enum', () => {
    expect([...envelopeSchema.properties.type.enum].sort()).toEqual([...MESSAGE_TYPES].sort());
  });

  it('dispatches remediation payloads to concrete JSON Schema definitions', () => {
    expect(schemaPayloadReference('translation.start')).toBe('#/$defs/translationStart');
    expect(schemaPayloadReference('translation.batch.continue')).toBe('#/$defs/translationStart');
    expect(schemaPayloadReference('translation.scan.report')).toBe('#/$defs/translationScanReport');
    expect(schemaPayloadReference('assistant.start')).toBe('#/$defs/assistantStart');
    expect(schemaPayloadReference('conversation.get.ready')).toBe('#/$defs/conversationGetReady');
    expect(schemaPayloadReference('model.catalog.ready')).toBe('#/$defs/modelCatalogReady');
    expect(schemaPayloadReference('model.selection.set')).toBe('#/$defs/modelSelectionInput');
  });

  it('keeps workspace, citation, conversation, and provider fields in the wire schema', () => {
    expect(envelopeSchema.$defs.assistantStart.properties.workspaceId.$ref).toBe(
      '#/$defs/identifier',
    );
    expect(envelopeSchema.$defs.assistantEvent.properties.citations.items.$ref).toBe(
      '#/$defs/assistantCitation',
    );
    expect(envelopeSchema.$defs.conversationMessage.properties.citations.items.$ref).toBe(
      '#/$defs/conversationCitation',
    );
    expect(envelopeSchema.$defs.modelCatalogEntry.required).toContain('providerId');
    expect(envelopeSchema.$defs.modelSelectionRecord.required).toContain('apiProfileId');
  });

  it('rejects an unknown protocol version', () => {
    expect(
      isProtocolEnvelope({
        protocolVersion: 9,
        requestId: crypto.randomUUID(),
        type: 'system.handshake.request',
        sequence: 0,
        done: true,
        payload: {},
      }),
    ).toBe(false);
  });

  it('accepts the scan-report acknowledgement emitted by the native host', () => {
    expect(
      isProtocolEnvelope(
        createEnvelope('translation.scan.report.ready', {
          accepted: true,
          pageJobId: crypto.randomUUID(),
          state: 'completed',
        }),
      ),
    ).toBe(true);
  });
});

describe('translation start preferences', () => {
  it('accepts bounded optional source language and technical tags', () => {
    expect(isTranslationStartPayload(validTranslationStart())).toBe(true);

    const legacyPayload: Record<string, unknown> = validTranslationStart();
    delete legacyPayload.sourceLanguage;
    delete legacyPayload.technicalTags;
    expect(isTranslationStartPayload(legacyPayload)).toBe(true);
  });

  it('rejects invalid source language and technical tag budgets', () => {
    expect(isTranslationStartPayload({ ...validTranslationStart(), sourceLanguage: '' })).toBe(
      false,
    );
    expect(
      isTranslationStartPayload({ ...validTranslationStart(), sourceLanguage: 'x'.repeat(33) }),
    ).toBe(false);
    expect(
      isTranslationStartPayload({
        ...validTranslationStart(),
        technicalTags: Array.from({ length: 17 }, (_, index) => `tag-${String(index)}`),
      }),
    ).toBe(false);
    expect(
      isTranslationStartPayload({
        ...validTranslationStart(),
        technicalTags: ['x'.repeat(65)],
      }),
    ).toBe(false);
  });

  it('requires coherent logical page-job batch metadata', () => {
    expect(
      isTranslationStartPayload({
        ...validTranslationStart(),
        pageJobId: crypto.randomUUID(),
      }),
    ).toBe(false);
    expect(
      isTranslationStartPayload({
        ...validTranslationStart(),
        batchIndex: 0,
        finalBatch: true,
      }),
    ).toBe(false);
    expect(
      isTranslationStartPayload({
        ...validTranslationStart(),
        pageJobId: crypto.randomUUID(),
        batchIndex: 0,
        finalBatch: true,
      }),
    ).toBe(true);
  });

  it('rejects incomplete split-node and unsupported reasoning combinations', () => {
    const payload = validTranslationStart();
    expect(
      isTranslationStartPayload({
        ...payload,
        segments: [{ ...payload.segments[0], partIndex: 0 }],
      }),
    ).toBe(false);
    expect(
      isTranslationStartPayload({
        ...payload,
        profile: {
          model: 'deepseek-v4-pro',
          thinking: 'disabled',
          reasoningEffort: 'high',
        },
      }),
    ).toBe(false);
  });
});

describe('translation scan report', () => {
  const diagnostics = {
    discoveredVisible: 4,
    eligible: 2,
    protected: 1,
    ignored: 1,
    queued: 0,
    completed: 1,
    failed: 0,
    stale: 1,
    overBudget: 0,
    unsupported: 0,
    cancelled: 0,
    notScanned: 0,
  };

  it('accepts bounded terminal node reasons and rejects unknown reasons', () => {
    const report = {
      taskId: crypto.randomUUID(),
      pageJobId: crypto.randomUUID(),
      pageSessionId: crypto.randomUUID(),
      diagnostics,
      segmentStates: { 'segment-1': 'stale' },
    };
    expect(isTranslationScanReportPayload(report)).toBe(true);
    expect(
      isTranslationScanReportPayload({
        ...report,
        segmentStates: { 'segment-1': 'ignored' },
      }),
    ).toBe(false);
  });
});
