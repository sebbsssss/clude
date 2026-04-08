import 'dart:async';
import 'dart:convert';

import 'api_exceptions.dart';

sealed class SseEvent {
  const SseEvent();
}

class SseChunk extends SseEvent {
  final String text;
  const SseChunk(this.text);
}

class SseDone extends SseEvent {
  final Map<String, dynamic>? data;
  const SseDone(this.data);
}

/// Parses an SSE byte stream (from Dio ResponseType.stream) into [SseEvent]s.
///
/// Supports both:
/// - Vercel AI SDK v6 UI message stream protocol (text-delta, finish, etc.)
/// - Legacy format (content/chunk fields, done flag)
Stream<SseEvent> parseSseStream(Stream<List<int>> byteStream) async* {
  final decoder = const Utf8Decoder(allowMalformed: true);
  var buffer = '';

  await for (final bytes in byteStream) {
    buffer += decoder.convert(bytes);
    final lines = buffer.split('\n');
    buffer = lines.removeLast(); // keep incomplete line in buffer

    for (final line in lines) {
      final event = _processLine(line);
      if (event == null) continue;
      yield event;
      if (event is SseDone) return;
    }
  }

  // Flush remaining buffer when stream ends without explicit done
  for (final line in buffer.split('\n')) {
    final event = _processLine(line);
    if (event == null) continue;
    yield event;
    if (event is SseDone) return;
  }
}

SseEvent? _processLine(String line) {
  // Skip SSE comments (keepalive pings)
  if (line.startsWith(':')) return null;
  if (!line.startsWith('data: ')) return null;

  final raw = line.substring(6);
  if (raw == '[DONE]') return const SseDone(null);

  try {
    final data = jsonDecode(raw) as Map<String, dynamic>;

    if (data['error'] != null) {
      throw ApiException(data['error'].toString());
    }

    final type = data['type'] as String?;

    // Vercel AI SDK v6 UI message stream protocol
    if (type != null) {
      switch (type) {
        case 'text-delta':
        case 'reasoning-delta':
          final delta = data['delta'] as String?;
          if (delta != null) return SseChunk(delta);
        case 'finish':
          return SseDone(data['messageMetadata'] as Map<String, dynamic>?);
        case 'error':
          throw ApiException(data['errorText']?.toString() ?? 'Stream error');
        // text-start, text-end, start, start-step, finish-step, etc. — skip
      }
      return null;
    }

    // Legacy format (greeting, guest chat)
    if (data['done'] == true) {
      return SseDone(data);
    }
    final content = data['content'] as String?;
    if (content != null) return SseChunk(content);
    final chunk = data['chunk'] as String?;
    if (chunk != null) return SseChunk(chunk);
  } catch (e) {
    if (e is ApiException) rethrow;
    // skip malformed JSON
  }
  return null;
}
