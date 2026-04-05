import 'package:freezed_annotation/freezed_annotation.dart';

part 'graph_data.freezed.dart';
part 'graph_data.g.dart';

@freezed
class GraphNode with _$GraphNode {
  const factory GraphNode({
    required int id,
    required String type,
    required String summary,
    @Default('') String content,
    @Default([]) List<String> tags,
    required double importance,
    @Default(0.5) double decay,
  }) = _GraphNode;

  factory GraphNode.fromJson(Map<String, dynamic> json) =>
      _$GraphNodeFromJson(json);
}

@freezed
class GraphLink with _$GraphLink {
  const factory GraphLink({
    @JsonKey(name: 'source_id') required int sourceId,
    @JsonKey(name: 'target_id') required int targetId,
    @JsonKey(name: 'link_type') required String linkType,
    @Default(0.5) double strength,
  }) = _GraphLink;

  factory GraphLink.fromJson(Map<String, dynamic> json) =>
      _$GraphLinkFromJson(json);
}

@freezed
class GraphData with _$GraphData {
  const factory GraphData({
    required List<GraphNode> nodes,
    required List<GraphLink> links,
    required int total,
  }) = _GraphData;

  factory GraphData.fromJson(Map<String, dynamic> json) =>
      _$GraphDataFromJson(json);
}
