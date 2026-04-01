import 'package:freezed_annotation/freezed_annotation.dart';

part 'memory_summary.freezed.dart';
part 'memory_summary.g.dart';

@freezed
class MemorySummary with _$MemorySummary {
  const factory MemorySummary({
    required int id,
    @JsonKey(name: 'memory_type') required String memoryType,
    required String summary,
    required double importance,
    @JsonKey(name: 'created_at') required String createdAt,
  }) = _MemorySummary;

  factory MemorySummary.fromJson(Map<String, dynamic> json) =>
      _$MemorySummaryFromJson(json);
}
