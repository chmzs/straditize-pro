/**
 * 统一前端错误监控与诊断报告生成器 (ErrorReporter).
 *
 * 核心功能：
 * 1. 环形日志记录：记录最近 50 条操作与系统事件 (Ring Buffer)；
 * 2. 异常自动捕获与后端直通：全局捕获 window.onerror 与 window.onunhandledrejection，
 *    通过 RPC system.logClientError 写入后端权威轮转日志；
 * 3. 机器与 AI 友好诊断报告生成：一键汇总环境、版本、后端日志状态、最近操作链与报错堆栈，
 *    生成标准 Markdown 供开发者与 AI 快速定位。
 */

import { APP_VERSION } from '../core/appVersion';
import { RpcClient } from './RpcClient';
import { notify } from '../ui/feedback';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  detail?: unknown;
}

class ErrorReporterService {
  private maxBufferSize: number = 50;
  private buffer: LogEntry[] = [];
  private rpcClient: RpcClient | null = null;
  private isReporting: boolean = false;
  private installed: boolean = false;
  private stateExtractor: (() => Record<string, unknown>) | null = null;
  private lastCapturedError: {
    message: string;
    stack?: string;
    timestamp: string;
    type: 'error' | 'unhandledrejection';
  } | null = null;

  /** 注册当前应用状态提取器（如步骤、ROI 数量等） */
  public registerStateExtractor(fn: () => Record<string, unknown>): void {
    this.stateExtractor = fn;
  }

  /** 初始化并安装全局错误监听器 */
  public install(rpcClient: RpcClient): void {
    this.rpcClient = rpcClient;
    if (this.installed) return;
    this.installed = true;

    // 1. 全局 JS 错误捕获
    window.addEventListener('error', (event: ErrorEvent) => {
      const msg = event.message || 'Script error';
      const stack = event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`;
      this.lastCapturedError = {
        message: msg,
        stack,
        timestamp: new Date().toISOString(),
        type: 'error',
      };
      this.log('error', 'GlobalError', msg, { filename: event.filename, lineno: event.lineno });
      void this.reportToBackend(msg, stack, window.location.href);
    });

    // 2. 全局 Promise Rejection 捕获
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let msg = 'Unhandled Promise Rejection';
      let stack = '';
      if (reason instanceof Error) {
        msg = reason.message;
        stack = reason.stack || '';
      } else if (typeof reason === 'string') {
        msg = reason;
      } else {
        try {
          msg = JSON.stringify(reason);
        } catch {
          msg = String(reason);
        }
      }

      this.lastCapturedError = {
        message: msg,
        stack,
        timestamp: new Date().toISOString(),
        type: 'unhandledrejection',
      };
      this.log('error', 'UnhandledRejection', msg);
      void this.reportToBackend(msg, stack, window.location.href);
    });

    this.log('info', 'System', `ErrorReporter installed (Straditize Pro v${APP_VERSION})`);
  }

  /** 记录一条前端运行事件 */
  public log(
    level: 'info' | 'warn' | 'error',
    category: string,
    message: string,
    detail?: unknown
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString().substring(11, 19),
      level,
      category,
      message,
      detail,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  /** 将客户端严重错误异步透传至后端统一轮转日志文件 */
  private async reportToBackend(message: string, stack?: string, url?: string): Promise<void> {
    if (!this.rpcClient || this.isReporting) return;
    this.isReporting = true;
    try {
      let context: Record<string, unknown> | undefined;
      if (this.stateExtractor) {
        try {
          context = this.stateExtractor();
        } catch {
          // 忽略状态提取错误
        }
      }
      await this.rpcClient.logClientError({
        message,
        stack,
        url,
        context,
      });
    } catch {
      // 避免自身上报失败造成二次异常
    } finally {
      this.isReporting = false;
    }
  }

  /** 生成 Markdown 格式结构化诊断报告 */
  public async generateDiagnosticReport(clientOverride?: RpcClient): Promise<string> {
    const client = clientOverride || this.rpcClient;
    const now = new Date().toISOString();
    const ua = navigator.userAgent;
    const screenInfo = `${window.screen.width}x${window.screen.height} (dpr: ${window.devicePixelRatio})`;

    let logInfo = {
      log_dir: 'Unknown',
      log_file: 'Unknown',
      file_size_bytes: 0,
    };

    if (client) {
      try {
        logInfo = await client.getLogInfo();
      } catch {
        // 离线或后端未响应
      }
    }

    let stateContext: Record<string, unknown> = {};
    if (this.stateExtractor) {
      try {
        stateContext = this.stateExtractor();
      } catch {
        // 忽略
      }
    }

    const sizeKb = (logInfo.file_size_bytes / 1024).toFixed(1);

    const lines: string[] = [];
    lines.push(`# Straditize Pro 诊断信息 (Diagnostic Report)`);
    lines.push(`- **生成时间**: ${now}`);
    lines.push(`- **版本**: v${APP_VERSION}`);
    lines.push(`- **操作系统 / 浏览器**: ${ua}`);
    lines.push(`- **屏幕规格**: ${screenInfo}`);
    lines.push(`- **页面 URL**: ${window.location.origin}${window.location.pathname}`);
    lines.push(``);
    lines.push(`## 日志存储 (Logging Status)`);
    lines.push(`- **后端日志目录**: \`${logInfo.log_dir}\``);
    lines.push(`- **当前活动日志文件**: \`${logInfo.log_file}\` (${sizeKb} KB)`);
    lines.push(`- **清理策略**: 单文件 5MB 轮转，最多 3 个备份 (≤15MB)，启动自动清理超过 7 天旧日志`);
    lines.push(``);

    if (Object.keys(stateContext).length > 0) {
      lines.push(`## 当前应用状态 (Application State)`);
      lines.push('```json');
      lines.push(JSON.stringify(stateContext, null, 2));
      lines.push('```');
      lines.push(``);
    }

    if (this.lastCapturedError) {
      lines.push(`## 最近捕获异常 (Last Captured Exception)`);
      lines.push(`- **类型**: ${this.lastCapturedError.type}`);
      lines.push(`- **时间**: ${this.lastCapturedError.timestamp}`);
      lines.push(`- **信息**: ${this.lastCapturedError.message}`);
      if (this.lastCapturedError.stack) {
        lines.push('```');
        lines.push(this.lastCapturedError.stack);
        lines.push('```');
      }
      lines.push(``);
    }

    lines.push(`## 最近操作事件序列 (Recent Events, Max 30)`);
    lines.push('| 时间 | 级别 | 分类 | 摘要 |');
    lines.push('| :--- | :--- | :--- | :--- |');
    const recent = this.buffer.slice(-30);
    for (const e of recent) {
      const cleanMsg = e.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${e.timestamp} | ${e.level.toUpperCase()} | ${e.category} | ${cleanMsg} |`);
    }

    return lines.join('\n');
  }

  /** 一键复制诊断报告并给予用户 Toast 提示 */
  public async copyDiagnosticReport(clientOverride?: RpcClient): Promise<boolean> {
    const report = await this.generateDiagnosticReport(clientOverride);
    try {
      await navigator.clipboard.writeText(report);
      notify('诊断信息已复制到剪贴板，可粘贴反馈给开发者或 AI', 'success', 4000);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) {
        notify('诊断信息已复制到剪贴板，可粘贴反馈给开发者或 AI', 'success', 4000);
        return true;
      }
      notify('无法写入剪贴板，请检查浏览器权限', 'warning');
      return false;
    }
  }
}

export const ErrorReporter = new ErrorReporterService();
