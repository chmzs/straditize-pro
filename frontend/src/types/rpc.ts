/**
 * JSON-RPC 2.0 Protocol Types and Authoritative Backend Method Registry.
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: RpcMethod | (string & {});
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: RpcMethod | (string & {});
  params: T;
}

export interface BackendStatus {
  connected: boolean;
  isMock: boolean;
  endpoint: string;
  latencyMs: number;
  isDesktopMode?: boolean;
}

/**
 * Authoritative list of all 103 registered backend RPC methods.
 * Strictly synchronized with straditize_core/protocol.py:ALL_RPC_METHODS
 * and verified via support/consistency_check.py.
 */
export type RpcMethod =
  | 'agedepth.checkREnvironment'
  | 'agedepth.extractAndInspect'
  | 'agedepth.generateBaconScript'
  | 'agedepth.generateEnsemble'
  | 'agedepth.generateGeoChronRScript'
  | 'agedepth.getInspection'
  | 'agedepth.loadModelDiagram'
  | 'agedepth.runBaconModeling'
  | 'agedepth.runLocalBacon'
  | 'agedepth.updateModel'
  | 'algorithm.applyLineRemoval'
  | 'algorithm.clearCleanupEdits'
  | 'algorithm.degrid'
  | 'algorithm.deleteLineGeometry'
  | 'algorithm.detectColumns'
  | 'algorithm.detectLineCandidates'
  | 'algorithm.detectXTicks'
  | 'algorithm.extractHorizonConsensus'
  | 'algorithm.extractTurningPoints'
  | 'algorithm.setGeometryStatus'
  | 'algorithm.setLineThickness'
  | 'algorithm.upsertLineGeometry'
  | 'column.add'
  | 'column.calibrateXTicks'
  | 'column.clearXTicks'
  | 'column.remove'
  | 'column.update'
  | 'component.getStatus'
  | 'component.install'
  | 'component.installOfflineZip'
  | 'component.uninstall'
  | 'core.applyDepthGrid'
  | 'core.batchSetTaxa'
  | 'core.calibrateAxes'
  | 'core.detectColumns'
  | 'core.digitize'
  | 'core.exportData'
  | 'core.extractForeground'
  | 'core.extractGridValues'
  | 'core.getStatus'
  | 'core.loadImage'
  | 'core.reset'
  | 'core.updateControlPoint'
  | 'ensemble.add'
  | 'ensemble.list'
  | 'export.csv'
  | 'export.exportLipd'
  | 'export.exportXlsx'
  | 'export.getReadiness'
  | 'export.r'
  | 'export.tar'
  | 'history.redo'
  | 'history.undo'
  | 'image.detectDeskew'
  | 'image.load'
  | 'image.rotate'
  | 'image.switchPdfPage'
  | 'initialize'
  | 'metadata.extractFromPdf'
  | 'metadata.fetchByDoi'
  | 'metadata.get'
  | 'metadata.parseExternalText'
  | 'metadata.update'
  | 'naming.renameColumn'
  | 'naming.snapLabels'
  | 'notifications/initialized'
  | 'ocr.applyLabels'
  | 'ocr.getTaxaDict'
  | 'ocr.parseTaxaText'
  | 'ocr.recognizeLabels'
  | 'ocr.saveCustomTaxa'
  | 'ping'
  | 'point.add'
  | 'point.move'
  | 'point.remove'
  | 'project.load'
  | 'project.new'
  | 'project.save'
  | 'qa.summarize'
  | 'roi.applyFormDefaults'
  | 'roi.create'
  | 'roi.groupCreate'
  | 'roi.groupRemove'
  | 'roi.groupUpdate'
  | 'roi.list'
  | 'roi.remove'
  | 'roi.setActive'
  | 'roi.setPrimary'
  | 'roi.update'
  | 'samples.clear'
  | 'samples.extractConsensus'
  | 'samples.list'
  | 'samples.pasteDepths'
  | 'samples.set'
  | 'shutdown'
  | 'straditize.getDiagramData'
  | 'system.getConfig'
  | 'system.ping'
  | 'system.updateConfig'
  | 'tools/call'
  | 'tools/list'
  | 'webmcp.callTool'
  | 'webmcp.listTools';
