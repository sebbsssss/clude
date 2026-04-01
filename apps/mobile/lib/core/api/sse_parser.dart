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
/// Port of `readSSE` from `apps/chat/src/lib/api.ts`.
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
    if (data['done'] == true) {
      return SseDone(data);
    }
    // TS version checks both fields independently; API never sends both in
    // one payload so early-return is safe here.
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
