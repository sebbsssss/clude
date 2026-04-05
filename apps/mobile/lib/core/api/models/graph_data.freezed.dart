// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'graph_data.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

GraphNode _$GraphNodeFromJson(Map<String, dynamic> json) {
  return _GraphNode.fromJson(json);
}

/// @nodoc
mixin _$GraphNode {
  int get id => throw _privateConstructorUsedError;
  String get type => throw _privateConstructorUsedError;
  String get summary => throw _privateConstructorUsedError;
  String get content => throw _privateConstructorUsedError;
  List<String> get tags => throw _privateConstructorUsedError;
  double get importance => throw _privateConstructorUsedError;
  double get decay => throw _privateConstructorUsedError;

  /// Serializes this GraphNode to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of GraphNode
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $GraphNodeCopyWith<GraphNode> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GraphNodeCopyWith<$Res> {
  factory $GraphNodeCopyWith(GraphNode value, $Res Function(GraphNode) then) =
      _$GraphNodeCopyWithImpl<$Res, GraphNode>;
  @useResult
  $Res call({
    int id,
    String type,
    String summary,
    String content,
    List<String> tags,
    double importance,
    double decay,
  });
}

/// @nodoc
class _$GraphNodeCopyWithImpl<$Res, $Val extends GraphNode>
    implements $GraphNodeCopyWith<$Res> {
  _$GraphNodeCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of GraphNode
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? summary = null,
    Object? content = null,
    Object? tags = null,
    Object? importance = null,
    Object? decay = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as int,
            type: null == type
                ? _value.type
                : type // ignore: cast_nullable_to_non_nullable
                      as String,
            summary: null == summary
                ? _value.summary
                : summary // ignore: cast_nullable_to_non_nullable
                      as String,
            content: null == content
                ? _value.content
                : content // ignore: cast_nullable_to_non_nullable
                      as String,
            tags: null == tags
                ? _value.tags
                : tags // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            importance: null == importance
                ? _value.importance
                : importance // ignore: cast_nullable_to_non_nullable
                      as double,
            decay: null == decay
                ? _value.decay
                : decay // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$GraphNodeImplCopyWith<$Res>
    implements $GraphNodeCopyWith<$Res> {
  factory _$$GraphNodeImplCopyWith(
    _$GraphNodeImpl value,
    $Res Function(_$GraphNodeImpl) then,
  ) = __$$GraphNodeImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    int id,
    String type,
    String summary,
    String content,
    List<String> tags,
    double importance,
    double decay,
  });
}

/// @nodoc
class __$$GraphNodeImplCopyWithImpl<$Res>
    extends _$GraphNodeCopyWithImpl<$Res, _$GraphNodeImpl>
    implements _$$GraphNodeImplCopyWith<$Res> {
  __$$GraphNodeImplCopyWithImpl(
    _$GraphNodeImpl _value,
    $Res Function(_$GraphNodeImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of GraphNode
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? summary = null,
    Object? content = null,
    Object? tags = null,
    Object? importance = null,
    Object? decay = null,
  }) {
    return _then(
      _$GraphNodeImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as int,
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        summary: null == summary
            ? _value.summary
            : summary // ignore: cast_nullable_to_non_nullable
                  as String,
        content: null == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String,
        tags: null == tags
            ? _value._tags
            : tags // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        importance: null == importance
            ? _value.importance
            : importance // ignore: cast_nullable_to_non_nullable
                  as double,
        decay: null == decay
            ? _value.decay
            : decay // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$GraphNodeImpl implements _GraphNode {
  const _$GraphNodeImpl({
    required this.id,
    required this.type,
    required this.summary,
    this.content = '',
    final List<String> tags = const [],
    required this.importance,
    this.decay = 0.5,
  }) : _tags = tags;

  factory _$GraphNodeImpl.fromJson(Map<String, dynamic> json) =>
      _$$GraphNodeImplFromJson(json);

  @override
  final int id;
  @override
  final String type;
  @override
  final String summary;
  @override
  @JsonKey()
  final String content;
  final List<String> _tags;
  @override
  @JsonKey()
  List<String> get tags {
    if (_tags is EqualUnmodifiableListView) return _tags;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_tags);
  }

  @override
  final double importance;
  @override
  @JsonKey()
  final double decay;

  @override
  String toString() {
    return 'GraphNode(id: $id, type: $type, summary: $summary, content: $content, tags: $tags, importance: $importance, decay: $decay)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GraphNodeImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.summary, summary) || other.summary == summary) &&
            (identical(other.content, content) || other.content == content) &&
            const DeepCollectionEquality().equals(other._tags, _tags) &&
            (identical(other.importance, importance) ||
                other.importance == importance) &&
            (identical(other.decay, decay) || other.decay == decay));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    type,
    summary,
    content,
    const DeepCollectionEquality().hash(_tags),
    importance,
    decay,
  );

  /// Create a copy of GraphNode
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$GraphNodeImplCopyWith<_$GraphNodeImpl> get copyWith =>
      __$$GraphNodeImplCopyWithImpl<_$GraphNodeImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GraphNodeImplToJson(this);
  }
}

abstract class _GraphNode implements GraphNode {
  const factory _GraphNode({
    required final int id,
    required final String type,
    required final String summary,
    final String content,
    final List<String> tags,
    required final double importance,
    final double decay,
  }) = _$GraphNodeImpl;

  factory _GraphNode.fromJson(Map<String, dynamic> json) =
      _$GraphNodeImpl.fromJson;

  @override
  int get id;
  @override
  String get type;
  @override
  String get summary;
  @override
  String get content;
  @override
  List<String> get tags;
  @override
  double get importance;
  @override
  double get decay;

  /// Create a copy of GraphNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$GraphNodeImplCopyWith<_$GraphNodeImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

GraphLink _$GraphLinkFromJson(Map<String, dynamic> json) {
  return _GraphLink.fromJson(json);
}

/// @nodoc
mixin _$GraphLink {
  @JsonKey(name: 'source_id')
  int get sourceId => throw _privateConstructorUsedError;
  @JsonKey(name: 'target_id')
  int get targetId => throw _privateConstructorUsedError;
  @JsonKey(name: 'link_type')
  String get linkType => throw _privateConstructorUsedError;
  double get strength => throw _privateConstructorUsedError;

  /// Serializes this GraphLink to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of GraphLink
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $GraphLinkCopyWith<GraphLink> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GraphLinkCopyWith<$Res> {
  factory $GraphLinkCopyWith(GraphLink value, $Res Function(GraphLink) then) =
      _$GraphLinkCopyWithImpl<$Res, GraphLink>;
  @useResult
  $Res call({
    @JsonKey(name: 'source_id') int sourceId,
    @JsonKey(name: 'target_id') int targetId,
    @JsonKey(name: 'link_type') String linkType,
    double strength,
  });
}

/// @nodoc
class _$GraphLinkCopyWithImpl<$Res, $Val extends GraphLink>
    implements $GraphLinkCopyWith<$Res> {
  _$GraphLinkCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of GraphLink
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? sourceId = null,
    Object? targetId = null,
    Object? linkType = null,
    Object? strength = null,
  }) {
    return _then(
      _value.copyWith(
            sourceId: null == sourceId
                ? _value.sourceId
                : sourceId // ignore: cast_nullable_to_non_nullable
                      as int,
            targetId: null == targetId
                ? _value.targetId
                : targetId // ignore: cast_nullable_to_non_nullable
                      as int,
            linkType: null == linkType
                ? _value.linkType
                : linkType // ignore: cast_nullable_to_non_nullable
                      as String,
            strength: null == strength
                ? _value.strength
                : strength // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$GraphLinkImplCopyWith<$Res>
    implements $GraphLinkCopyWith<$Res> {
  factory _$$GraphLinkImplCopyWith(
    _$GraphLinkImpl value,
    $Res Function(_$GraphLinkImpl) then,
  ) = __$$GraphLinkImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    @JsonKey(name: 'source_id') int sourceId,
    @JsonKey(name: 'target_id') int targetId,
    @JsonKey(name: 'link_type') String linkType,
    double strength,
  });
}

/// @nodoc
class __$$GraphLinkImplCopyWithImpl<$Res>
    extends _$GraphLinkCopyWithImpl<$Res, _$GraphLinkImpl>
    implements _$$GraphLinkImplCopyWith<$Res> {
  __$$GraphLinkImplCopyWithImpl(
    _$GraphLinkImpl _value,
    $Res Function(_$GraphLinkImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of GraphLink
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? sourceId = null,
    Object? targetId = null,
    Object? linkType = null,
    Object? strength = null,
  }) {
    return _then(
      _$GraphLinkImpl(
        sourceId: null == sourceId
            ? _value.sourceId
            : sourceId // ignore: cast_nullable_to_non_nullable
                  as int,
        targetId: null == targetId
            ? _value.targetId
            : targetId // ignore: cast_nullable_to_non_nullable
                  as int,
        linkType: null == linkType
            ? _value.linkType
            : linkType // ignore: cast_nullable_to_non_nullable
                  as String,
        strength: null == strength
            ? _value.strength
            : strength // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$GraphLinkImpl implements _GraphLink {
  const _$GraphLinkImpl({
    @JsonKey(name: 'source_id') required this.sourceId,
    @JsonKey(name: 'target_id') required this.targetId,
    @JsonKey(name: 'link_type') required this.linkType,
    this.strength = 0.5,
  });

  factory _$GraphLinkImpl.fromJson(Map<String, dynamic> json) =>
      _$$GraphLinkImplFromJson(json);

  @override
  @JsonKey(name: 'source_id')
  final int sourceId;
  @override
  @JsonKey(name: 'target_id')
  final int targetId;
  @override
  @JsonKey(name: 'link_type')
  final String linkType;
  @override
  @JsonKey()
  final double strength;

  @override
  String toString() {
    return 'GraphLink(sourceId: $sourceId, targetId: $targetId, linkType: $linkType, strength: $strength)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GraphLinkImpl &&
            (identical(other.sourceId, sourceId) ||
                other.sourceId == sourceId) &&
            (identical(other.targetId, targetId) ||
                other.targetId == targetId) &&
            (identical(other.linkType, linkType) ||
                other.linkType == linkType) &&
            (identical(other.strength, strength) ||
                other.strength == strength));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, sourceId, targetId, linkType, strength);

  /// Create a copy of GraphLink
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$GraphLinkImplCopyWith<_$GraphLinkImpl> get copyWith =>
      __$$GraphLinkImplCopyWithImpl<_$GraphLinkImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GraphLinkImplToJson(this);
  }
}

abstract class _GraphLink implements GraphLink {
  const factory _GraphLink({
    @JsonKey(name: 'source_id') required final int sourceId,
    @JsonKey(name: 'target_id') required final int targetId,
    @JsonKey(name: 'link_type') required final String linkType,
    final double strength,
  }) = _$GraphLinkImpl;

  factory _GraphLink.fromJson(Map<String, dynamic> json) =
      _$GraphLinkImpl.fromJson;

  @override
  @JsonKey(name: 'source_id')
  int get sourceId;
  @override
  @JsonKey(name: 'target_id')
  int get targetId;
  @override
  @JsonKey(name: 'link_type')
  String get linkType;
  @override
  double get strength;

  /// Create a copy of GraphLink
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$GraphLinkImplCopyWith<_$GraphLinkImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

GraphData _$GraphDataFromJson(Map<String, dynamic> json) {
  return _GraphData.fromJson(json);
}

/// @nodoc
mixin _$GraphData {
  List<GraphNode> get nodes => throw _privateConstructorUsedError;
  List<GraphLink> get links => throw _privateConstructorUsedError;
  int get total => throw _privateConstructorUsedError;

  /// Serializes this GraphData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of GraphData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $GraphDataCopyWith<GraphData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GraphDataCopyWith<$Res> {
  factory $GraphDataCopyWith(GraphData value, $Res Function(GraphData) then) =
      _$GraphDataCopyWithImpl<$Res, GraphData>;
  @useResult
  $Res call({List<GraphNode> nodes, List<GraphLink> links, int total});
}

/// @nodoc
class _$GraphDataCopyWithImpl<$Res, $Val extends GraphData>
    implements $GraphDataCopyWith<$Res> {
  _$GraphDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of GraphData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? nodes = null,
    Object? links = null,
    Object? total = null,
  }) {
    return _then(
      _value.copyWith(
            nodes: null == nodes
                ? _value.nodes
                : nodes // ignore: cast_nullable_to_non_nullable
                      as List<GraphNode>,
            links: null == links
                ? _value.links
                : links // ignore: cast_nullable_to_non_nullable
                      as List<GraphLink>,
            total: null == total
                ? _value.total
                : total // ignore: cast_nullable_to_non_nullable
                      as int,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$GraphDataImplCopyWith<$Res>
    implements $GraphDataCopyWith<$Res> {
  factory _$$GraphDataImplCopyWith(
    _$GraphDataImpl value,
    $Res Function(_$GraphDataImpl) then,
  ) = __$$GraphDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({List<GraphNode> nodes, List<GraphLink> links, int total});
}

/// @nodoc
class __$$GraphDataImplCopyWithImpl<$Res>
    extends _$GraphDataCopyWithImpl<$Res, _$GraphDataImpl>
    implements _$$GraphDataImplCopyWith<$Res> {
  __$$GraphDataImplCopyWithImpl(
    _$GraphDataImpl _value,
    $Res Function(_$GraphDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of GraphData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? nodes = null,
    Object? links = null,
    Object? total = null,
  }) {
    return _then(
      _$GraphDataImpl(
        nodes: null == nodes
            ? _value._nodes
            : nodes // ignore: cast_nullable_to_non_nullable
                  as List<GraphNode>,
        links: null == links
            ? _value._links
            : links // ignore: cast_nullable_to_non_nullable
                  as List<GraphLink>,
        total: null == total
            ? _value.total
            : total // ignore: cast_nullable_to_non_nullable
                  as int,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$GraphDataImpl implements _GraphData {
  const _$GraphDataImpl({
    required final List<GraphNode> nodes,
    required final List<GraphLink> links,
    required this.total,
  }) : _nodes = nodes,
       _links = links;

  factory _$GraphDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$GraphDataImplFromJson(json);

  final List<GraphNode> _nodes;
  @override
  List<GraphNode> get nodes {
    if (_nodes is EqualUnmodifiableListView) return _nodes;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_nodes);
  }

  final List<GraphLink> _links;
  @override
  List<GraphLink> get links {
    if (_links is EqualUnmodifiableListView) return _links;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_links);
  }

  @override
  final int total;

  @override
  String toString() {
    return 'GraphData(nodes: $nodes, links: $links, total: $total)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GraphDataImpl &&
            const DeepCollectionEquality().equals(other._nodes, _nodes) &&
            const DeepCollectionEquality().equals(other._links, _links) &&
            (identical(other.total, total) || other.total == total));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    const DeepCollectionEquality().hash(_nodes),
    const DeepCollectionEquality().hash(_links),
    total,
  );

  /// Create a copy of GraphData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$GraphDataImplCopyWith<_$GraphDataImpl> get copyWith =>
      __$$GraphDataImplCopyWithImpl<_$GraphDataImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GraphDataImplToJson(this);
  }
}

abstract class _GraphData implements GraphData {
  const factory _GraphData({
    required final List<GraphNode> nodes,
    required final List<GraphLink> links,
    required final int total,
  }) = _$GraphDataImpl;

  factory _GraphData.fromJson(Map<String, dynamic> json) =
      _$GraphDataImpl.fromJson;

  @override
  List<GraphNode> get nodes;
  @override
  List<GraphLink> get links;
  @override
  int get total;

  /// Create a copy of GraphData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$GraphDataImplCopyWith<_$GraphDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
