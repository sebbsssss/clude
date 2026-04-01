import 'package:freezed_annotation/freezed_annotation.dart';

part 'memory_stats.freezed.dart';
part 'memory_stats.g.dart';

@freezed
class TagCount with _$TagCount {
  const factory TagCount({
    required String tag,
    required int count,
  }) = _TagCount;

  factory TagCount.fromJson(Map<String, dynamic> json) =>
      _$TagCountFromJson(json);
}

@freezed
class MemoryStats with _$MemoryStats {
  const factory MemoryStats({
    required int total,
    required Map<String, int> byType,
    required double avgImportance,
    required double avgDecay,
    required List<TagCount> topTags,
  }) = _MemoryStats;

  factory MemoryStats.fromJson(Map<String, dynamic> json) =>
      _$MemoryStatsFromJson(json);
}
