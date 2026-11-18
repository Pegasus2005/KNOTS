declare module 'openai' {
  export namespace OpenAI {
    export class APIError extends Error {
      status?: number;
    }
    export namespace Chat {
      export interface ChatCompletionMessageParam {
        role: 'system' | 'user' | 'assistant';
        content: string;
      }
      export interface ChatCompletionCreateParamsNonStreaming {
        model: string;
        messages: ChatCompletionMessageParam[];
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
        stop?: string[];
        response_format?: { type: string };
      }
      export interface ChatCompletionChunk {
        choices: Array<{
          delta?: { content?: string };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      }
      export interface ChatCompletion {
        model: string;
        choices: Array<{
          message?: { content?: string };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      }
    }
  }

  export class OpenAI {
    static APIError: typeof OpenAI.APIError;
    constructor(config?: {
      apiKey?: string;
      baseURL?: string;
      defaultHeaders?: Record<string, string>;
    });
    chat: {
      completions: {
        create(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { stream: true }, options?: { signal?: AbortSignal }): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>;
        create(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { stream: false }, options?: { signal?: AbortSignal }): Promise<OpenAI.Chat.ChatCompletion>;
        create(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { stream?: boolean }, options?: { signal?: AbortSignal }): Promise<any>;
      };
    };
    models: {
      list(): Promise<AsyncIterable<{ id: string }>>;
    };
  }

  export default OpenAI;
}

declare module '@anthropic-ai/sdk' {
  export namespace Anthropic {
    export class APIError extends Error {
      status?: number;
    }
    export interface TextBlock {
      type: 'text';
      text: string;
    }
    export interface MessageParam {
      role: 'user' | 'assistant';
      content: string;
    }
    export interface MessageCreateParamsNonStreaming {
      model: string;
      messages: MessageParam[];
      max_tokens: number;
      stream?: boolean;
      system?: string;
      temperature?: number;
      stop_sequences?: string[];
    }
    export interface Message {
      model: string;
      content: Array<{ type: string; text?: string }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      stop_reason?: string;
    }
  }

  export class Anthropic {
    static APIError: typeof Anthropic.APIError;
    constructor(config?: { apiKey?: string; baseURL?: string });
    messages: {
      create(params: Anthropic.MessageCreateParamsNonStreaming & { stream: true }, options?: { signal?: AbortSignal }): Promise<AsyncIterable<any>>;
      create(params: Anthropic.MessageCreateParamsNonStreaming & { stream: false }, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
      create(params: Anthropic.MessageCreateParamsNonStreaming & { stream?: boolean }, options?: { signal?: AbortSignal }): Promise<any>;
    };
  }

  export default Anthropic;
}

declare module '@google/generative-ai' {
  export interface Content {
    role: string;
    parts: Array<{ text: string }>;
  }
  export interface GenerateContentResult {
    response: {
      text?(): string;
      candidates?: Array<{ finishReason?: string }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
  }
  export interface EnhancedGenerateContentResponse {
    text?(): string;
    candidates?: Array<{ finishReason?: string }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }
  export interface GenerativeModel {
    generateContent(params: { contents: Content[] }, options?: { signal?: AbortSignal }): Promise<GenerateContentResult>;
    generateContentStream(params: { contents: Content[] }, options?: { signal?: AbortSignal }): Promise<{
      stream: AsyncIterable<EnhancedGenerateContentResponse>;
    }>;
  }
  export enum HarmCategory {}
  export enum HarmBlockThreshold {}
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: {
      model: string;
      systemInstruction?: string;
      generationConfig?: Record<string, unknown>;
    }): GenerativeModel;
  }
}
