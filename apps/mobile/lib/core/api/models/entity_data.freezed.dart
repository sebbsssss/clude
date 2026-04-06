// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'entity_data.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

GraphEntity _$GraphEntityFromJson(Map<String, dynamic> json) {
  return _GraphEntity.fromJson(json);
}

/// @nodoc
mixin _$GraphEntity {
  int get id => throw _privateConstructorUsedError;
  String get type => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  List<String> get aliases => throw _privateConstructorUsedError;
  String get description => throw _privateConstructorUsedError;
  @JsonKey(name: 'mentionCount')
  int get mentionCount => throw _privateConstructorUsedError;
  @JsonKey(name: 'firstSeen')
  String? get firstSeen => throw _privateConstructorUsedError;
  @JsonKey(name: 'lastSeen')
  String? get lastSeen => throw _privateConstructorUsedError;

  /// Serializes this GraphEntity to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of GraphEntity
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $GraphEntityCopyWith<GraphEntity> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GraphEntityCopyWith<$Res> {
  factory $GraphEntityCopyWith(
    GraphEntity value,
    $Res Function(GraphEntity) then,
  ) = _$GraphEntityCopyWithImpl<$Res, GraphEntity>;
  @useResult
  $Res call({
    int id,
    String type,
    String name,
    List<String> aliases,
    String description,
    @JsonKey(name: 'mentionCount') int mentionCount,
    @JsonKey(name: 'firstSeen') String? firstSeen,
    @JsonKey(name: 'lastSeen') String? lastSeen,
  });
}

/// @nodoc
class _$GraphEntityCopyWithImpl<$Res, $Val extends GraphEntity>
    implements $GraphEntityCopyWith<$Res> {
  _$GraphEntityCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of GraphEntity
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? name = null,
    Object? aliases = null,
    Object? description = null,
    Object? mentionCount = null,
    Object? firstSeen = freezed,
    Object? lastSeen = freezed,
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
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            aliases: null == aliases
                ? _value.aliases
                : aliases // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            description: null == description
                ? _value.description
                : description // ignore: cast_nullable_to_non_nullable
                      as String,
            mentionCount: null == mentionCount
                ? _value.mentionCount
                : mentionCount // ignore: cast_nullable_to_non_nullable
                      as int,
            firstSeen: freezed == firstSeen
                ? _value.firstSeen
                : firstSeen // ignore: cast_nullable_to_non_nullable
                      as String?,
            lastSeen: freezed == lastSeen
                ? _value.lastSeen
                : lastSeen // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$GraphEntityImplCopyWith<$Res>
    implements $GraphEntityCopyWith<$Res> {
  factory _$$GraphEntityImplCopyWith(
    _$GraphEntityImpl value,
    $Res Function(_$GraphEntityImpl) then,
  ) = __$$GraphEntityImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    int id,
    String type,
    String name,
    List<String> aliases,
    String description,
    @JsonKey(name: 'mentionCount') int mentionCount,
    @JsonKey(name: 'firstSeen') String? firstSeen,
    @JsonKey(name: 'lastSeen') String? lastSeen,
  });
}

/// @nodoc
class __$$GraphEntityImplCopyWithImpl<$Res>
    extends _$GraphEntityCopyWithImpl<$Res, _$GraphEntityImpl>
    implements _$$GraphEntityImplCopyWith<$Res> {
  __$$GraphEntityImplCopyWithImpl(
    _$GraphEntityImpl _value,
    $Res Function(_$GraphEntityImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of GraphEntity
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? name = null,
    Object? aliases = null,
    Object? description = null,
    Object? mentionCount = null,
    Object? firstSeen = freezed,
    Object? lastSeen = freezed,
  }) {
    return _then(
      _$GraphEntityImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as int,
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        aliases: null == aliases
            ? _value._aliases
            : aliases // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        description: null == description
            ? _value.description
            : description // ignore: cast_nullable_to_non_nullable
                  as String,
        mentionCount: null == mentionCount
            ? _value.mentionCount
            : mentionCount // ignore: cast_nullable_to_non_nullable
                  as int,
        firstSeen: freezed == firstSeen
            ? _value.firstSeen
            : firstSeen // ignore: cast_nullable_to_non_nullable
                  as String?,
        lastSeen: freezed == lastSeen
            ? _value.lastSeen
            : lastSeen // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$GraphEntityImpl implements _GraphEntity {
  const _$GraphEntityImpl({
    required this.id,
    required this.type,
    required this.name,
    final List<String> aliases = const [],
    this.description = '',
    @JsonKey(name: 'mentionCount') this.mentionCount = 0,
    @JsonKey(name: 'firstSeen') this.firstSeen,
    @JsonKey(name: 'lastSeen') this.lastSeen,
  }) : _aliases = aliases;

  factory _$GraphEntityImpl.fromJson(Map<String, dynamic> json) =>
      _$$GraphEntityImplFromJson(json);

  @override
  final int id;
  @override
  final String type;
  @override
  final String name;
  final List<String> _aliases;
  @override
  @JsonKey()
  List<String> get aliases {
    if (_aliases is EqualUnmodifiableListView) return _aliases;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_aliases);
  }

  @override
  @JsonKey()
  final String description;
  @override
  @JsonKey(name: 'mentionCount')
  final int mentionCount;
  @override
  @JsonKey(name: 'firstSeen')
  final String? firstSeen;
  @override
  @JsonKey(name: 'lastSeen')
  final String? lastSeen;

  @override
  String toString() {
    return 'GraphEntity(id: $id, type: $type, name: $name, aliases: $aliases, description: $description, mentionCount: $mentionCount, firstSeen: $firstSeen, lastSeen: $lastSeen)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GraphEntityImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.name, name) || other.name == name) &&
            const DeepCollectionEquality().equals(other._aliases, _aliases) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.mentionCount, mentionCount) ||
                other.mentionCount == mentionCount) &&
            (identical(other.firstSeen, firstSeen) ||
                other.firstSeen == firstSeen) &&
            (identical(other.lastSeen, lastSeen) ||
                other.lastSeen == lastSeen));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    type,
    name,
    const DeepCollectionEquality().hash(_aliases),
    description,
    mentionCount,
    firstSeen,
    lastSeen,
  );

  /// Create a copy of GraphEntity
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$GraphEntityImplCopyWith<_$GraphEntityImpl> get copyWith =>
      __$$GraphEntityImplCopyWithImpl<_$GraphEntityImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GraphEntityImplToJson(this);
  }
}

abstract class _GraphEntity implements GraphEntity {
  const factory _GraphEntity({
    required final int id,
    required final String type,
    required final String name,
    final List<String> aliases,
    final String description,
    @JsonKey(name: 'mentionCount') final int mentionCount,
    @JsonKey(name: 'firstSeen') final String? firstSeen,
    @JsonKey(name: 'lastSeen') final String? lastSeen,
  }) = _$GraphEntityImpl;

  factory _GraphEntity.fromJson(Map<String, dynamic> json) =
      _$GraphEntityImpl.fromJson;

  @override
  int get id;
  @override
  String get type;
  @override
  String get name;
  @override
  List<String> get aliases;
  @override
  String get description;
  @override
  @JsonKey(name: 'mentionCount')
  int get mentionCount;
  @override
  @JsonKey(name: 'firstSeen')
  String? get firstSeen;
  @override
  @JsonKey(name: 'lastSeen')
  String? get lastSeen;

  /// Create a copy of GraphEntity
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$GraphEntityImplCopyWith<_$GraphEntityImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

EntityMemory _$EntityMemoryFromJson(Map<String, dynamic> json) {
  return _EntityMemory.fromJson(json);
}

/// @nodoc
mixin _$EntityMemory {
  int get id => throw _privateConstructorUsedError;
  String get type => throw _privateConstructorUsedError;
  String get summary => throw _privateConstructorUsedError;
  double get importance => throw _privateConstructorUsedError;
  @JsonKey(name: 'createdAt')
  String get createdAt => throw _privateConstructorUsedError;

  /// Serializes this EntityMemory to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of EntityMemory
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $EntityMemoryCopyWith<EntityMemory> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $EntityMemoryCopyWith<$Res> {
  factory $EntityMemoryCopyWith(
    EntityMemory value,
    $Res Function(EntityMemory) then,
  ) = _$EntityMemoryCopyWithImpl<$Res, EntityMemory>;
  @useResult
  $Res call({
    int id,
    String type,
    String summary,
    double importance,
    @JsonKey(name: 'createdAt') String createdAt,
  });
}

/// @nodoc
class _$EntityMemoryCopyWithImpl<$Res, $Val extends EntityMemory>
    implements $EntityMemoryCopyWith<$Res> {
  _$EntityMemoryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of EntityMemory
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? summary = null,
    Object? importance = null,
    Object? createdAt = null,
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
            importance: null == importance
                ? _value.importance
                : importance // ignore: cast_nullable_to_non_nullable
                      as double,
            createdAt: null == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$EntityMemoryImplCopyWith<$Res>
    implements $EntityMemoryCopyWith<$Res> {
  factory _$$EntityMemoryImplCopyWith(
    _$EntityMemoryImpl value,
    $Res Function(_$EntityMemoryImpl) then,
  ) = __$$EntityMemoryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    int id,
    String type,
    String summary,
    double importance,
    @JsonKey(name: 'createdAt') String createdAt,
  });
}

/// @nodoc
class __$$EntityMemoryImplCopyWithImpl<$Res>
    extends _$EntityMemoryCopyWithImpl<$Res, _$EntityMemoryImpl>
    implements _$$EntityMemoryImplCopyWith<$Res> {
  __$$EntityMemoryImplCopyWithImpl(
    _$EntityMemoryImpl _value,
    $Res Function(_$EntityMemoryImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of EntityMemory
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? summary = null,
    Object? importance = null,
    Object? createdAt = null,
  }) {
    return _then(
      _$EntityMemoryImpl(
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
        importance: null == importance
            ? _value.importance
            : importance // ignore: cast_nullable_to_non_nullable
                  as double,
        createdAt: null == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$EntityMemoryImpl implements _EntityMemory {
  const _$EntityMemoryImpl({
    required this.id,
    required this.type,
    required this.summary,
    required this.importance,
    @JsonKey(name: 'createdAt') required this.createdAt,
  });

  factory _$EntityMemoryImpl.fromJson(Map<String, dynamic> json) =>
      _$$EntityMemoryImplFromJson(json);

  @override
  final int id;
  @override
  final String type;
  @override
  final String summary;
  @override
  final double importance;
  @override
  @JsonKey(name: 'createdAt')
  final String createdAt;

  @override
  String toString() {
    return 'EntityMemory(id: $id, type: $type, summary: $summary, importance: $importance, createdAt: $createdAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EntityMemoryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.summary, summary) || other.summary == summary) &&
            (identical(other.importance, importance) ||
                other.importance == importance) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, type, summary, importance, createdAt);

  /// Create a copy of EntityMemory
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$EntityMemoryImplCopyWith<_$EntityMemoryImpl> get copyWith =>
      __$$EntityMemoryImplCopyWithImpl<_$EntityMemoryImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$EntityMemoryImplToJson(this);
  }
}

abstract class _EntityMemory implements EntityMemory {
  const factory _EntityMemory({
    required final int id,
    required final String type,
    required final String summary,
    required final double importance,
    @JsonKey(name: 'createdAt') required final String createdAt,
  }) = _$EntityMemoryImpl;

  factory _EntityMemory.fromJson(Map<String, dynamic> json) =
      _$EntityMemoryImpl.fromJson;

  @override
  int get id;
  @override
  String get type;
  @override
  String get summary;
  @override
  double get importance;
  @override
  @JsonKey(name: 'createdAt')
  String get createdAt;

  /// Create a copy of EntityMemory
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$EntityMemoryImplCopyWith<_$EntityMemoryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

RelatedEntity _$RelatedEntityFromJson(Map<String, dynamic> json) {
  return _RelatedEntity.fromJson(json);
}

/// @nodoc
mixin _$RelatedEntity {
  @JsonKey(name: 'entityId')
  int get entityId => throw _privateConstructorUsedError;
  @JsonKey(name: 'cooccurrenceCount')
  int get cooccurrenceCount => throw _privateConstructorUsedError;
  @JsonKey(name: 'avgSalience')
  double get avgSalience => throw _privateConstructorUsedError;

  /// Serializes this RelatedEntity to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of RelatedEntity
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $RelatedEntityCopyWith<RelatedEntity> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $RelatedEntityCopyWith<$Res> {
  factory $RelatedEntityCopyWith(
    RelatedEntity value,
    $Res Function(RelatedEntity) then,
  ) = _$RelatedEntityCopyWithImpl<$Res, RelatedEntity>;
  @useResult
  $Res call({
    @JsonKey(name: 'entityId') int entityId,
    @JsonKey(name: 'cooccurrenceCount') int cooccurrenceCount,
    @JsonKey(name: 'avgSalience') double avgSalience,
  });
}

/// @nodoc
class _$RelatedEntityCopyWithImpl<$Res, $Val extends RelatedEntity>
    implements $RelatedEntityCopyWith<$Res> {
  _$RelatedEntityCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of RelatedEntity
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? entityId = null,
    Object? cooccurrenceCount = null,
    Object? avgSalience = null,
  }) {
    return _then(
      _value.copyWith(
            entityId: null == entityId
                ? _value.entityId
                : entityId // ignore: cast_nullable_to_non_nullable
                      as int,
            cooccurrenceCount: null == cooccurrenceCount
                ? _value.cooccurrenceCount
                : cooccurrenceCount // ignore: cast_nullable_to_non_nullable
                      as int,
            avgSalience: null == avgSalience
                ? _value.avgSalience
                : avgSalience // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$RelatedEntityImplCopyWith<$Res>
    implements $RelatedEntityCopyWith<$Res> {
  factory _$$RelatedEntityImplCopyWith(
    _$RelatedEntityImpl value,
    $Res Function(_$RelatedEntityImpl) then,
  ) = __$$RelatedEntityImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    @JsonKey(name: 'entityId') int entityId,
    @JsonKey(name: 'cooccurrenceCount') int cooccurrenceCount,
    @JsonKey(name: 'avgSalience') double avgSalience,
  });
}

/// @nodoc
class __$$RelatedEntityImplCopyWithImpl<$Res>
    extends _$RelatedEntityCopyWithImpl<$Res, _$RelatedEntityImpl>
    implements _$$RelatedEntityImplCopyWith<$Res> {
  __$$RelatedEntityImplCopyWithImpl(
    _$RelatedEntityImpl _value,
    $Res Function(_$RelatedEntityImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of RelatedEntity
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? entityId = null,
    Object? cooccurrenceCount = null,
    Object? avgSalience = null,
  }) {
    return _then(
      _$RelatedEntityImpl(
        entityId: null == entityId
            ? _value.entityId
            : entityId // ignore: cast_nullable_to_non_nullable
                  as int,
        cooccurrenceCount: null == cooccurrenceCount
            ? _value.cooccurrenceCount
            : cooccurrenceCount // ignore: cast_nullable_to_non_nullable
                  as int,
        avgSalience: null == avgSalience
            ? _value.avgSalience
            : avgSalience // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$RelatedEntityImpl implements _RelatedEntity {
  const _$RelatedEntityImpl({
    @JsonKey(name: 'entityId') required this.entityId,
    @JsonKey(name: 'cooccurrenceCount') this.cooccurrenceCount = 0,
    @JsonKey(name: 'avgSalience') this.avgSalience = 0.0,
  });

  factory _$RelatedEntityImpl.fromJson(Map<String, dynamic> json) =>
      _$$RelatedEntityImplFromJson(json);

  @override
  @JsonKey(name: 'entityId')
  final int entityId;
  @override
  @JsonKey(name: 'cooccurrenceCount')
  final int cooccurrenceCount;
  @override
  @JsonKey(name: 'avgSalience')
  final double avgSalience;

  @override
  String toString() {
    return 'RelatedEntity(entityId: $entityId, cooccurrenceCount: $cooccurrenceCount, avgSalience: $avgSalience)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RelatedEntityImpl &&
            (identical(other.entityId, entityId) ||
                other.entityId == entityId) &&
            (identical(other.cooccurrenceCount, cooccurrenceCount) ||
                other.cooccurrenceCount == cooccurrenceCount) &&
            (identical(other.avgSalience, avgSalience) ||
                other.avgSalience == avgSalience));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, entityId, cooccurrenceCount, avgSalience);

  /// Create a copy of RelatedEntity
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$RelatedEntityImplCopyWith<_$RelatedEntityImpl> get copyWith =>
      __$$RelatedEntityImplCopyWithImpl<_$RelatedEntityImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$RelatedEntityImplToJson(this);
  }
}

abstract class _RelatedEntity implements RelatedEntity {
  const factory _RelatedEntity({
    @JsonKey(name: 'entityId') required final int entityId,
    @JsonKey(name: 'cooccurrenceCount') final int cooccurrenceCount,
    @JsonKey(name: 'avgSalience') final double avgSalience,
  }) = _$RelatedEntityImpl;

  factory _RelatedEntity.fromJson(Map<String, dynamic> json) =
      _$RelatedEntityImpl.fromJson;

  @override
  @JsonKey(name: 'entityId')
  int get entityId;
  @override
  @JsonKey(name: 'cooccurrenceCount')
  int get cooccurrenceCount;
  @override
  @JsonKey(name: 'avgSalience')
  double get avgSalience;

  /// Create a copy of RelatedEntity
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$RelatedEntityImplCopyWith<_$RelatedEntityImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

EntityDetail _$EntityDetailFromJson(Map<String, dynamic> json) {
  return _EntityDetail.fromJson(json);
}

/// @nodoc
mixin _$EntityDetail {
  GraphEntity get entity => throw _privateConstructorUsedError;
  List<EntityMemory> get memories => throw _privateConstructorUsedError;
  List<RelatedEntity> get relatedEntities => throw _privateConstructorUsedError;

  /// Serializes this EntityDetail to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $EntityDetailCopyWith<EntityDetail> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $EntityDetailCopyWith<$Res> {
  factory $EntityDetailCopyWith(
    EntityDetail value,
    $Res Function(EntityDetail) then,
  ) = _$EntityDetailCopyWithImpl<$Res, EntityDetail>;
  @useResult
  $Res call({
    GraphEntity entity,
    List<EntityMemory> memories,
    List<RelatedEntity> relatedEntities,
  });

  $GraphEntityCopyWith<$Res> get entity;
}

/// @nodoc
class _$EntityDetailCopyWithImpl<$Res, $Val extends EntityDetail>
    implements $EntityDetailCopyWith<$Res> {
  _$EntityDetailCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? entity = null,
    Object? memories = null,
    Object? relatedEntities = null,
  }) {
    return _then(
      _value.copyWith(
            entity: null == entity
                ? _value.entity
                : entity // ignore: cast_nullable_to_non_nullable
                      as GraphEntity,
            memories: null == memories
                ? _value.memories
                : memories // ignore: cast_nullable_to_non_nullable
                      as List<EntityMemory>,
            relatedEntities: null == relatedEntities
                ? _value.relatedEntities
                : relatedEntities // ignore: cast_nullable_to_non_nullable
                      as List<RelatedEntity>,
          )
          as $Val,
    );
  }

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $GraphEntityCopyWith<$Res> get entity {
    return $GraphEntityCopyWith<$Res>(_value.entity, (value) {
      return _then(_value.copyWith(entity: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$EntityDetailImplCopyWith<$Res>
    implements $EntityDetailCopyWith<$Res> {
  factory _$$EntityDetailImplCopyWith(
    _$EntityDetailImpl value,
    $Res Function(_$EntityDetailImpl) then,
  ) = __$$EntityDetailImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    GraphEntity entity,
    List<EntityMemory> memories,
    List<RelatedEntity> relatedEntities,
  });

  @override
  $GraphEntityCopyWith<$Res> get entity;
}

/// @nodoc
class __$$EntityDetailImplCopyWithImpl<$Res>
    extends _$EntityDetailCopyWithImpl<$Res, _$EntityDetailImpl>
    implements _$$EntityDetailImplCopyWith<$Res> {
  __$$EntityDetailImplCopyWithImpl(
    _$EntityDetailImpl _value,
    $Res Function(_$EntityDetailImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? entity = null,
    Object? memories = null,
    Object? relatedEntities = null,
  }) {
    return _then(
      _$EntityDetailImpl(
        entity: null == entity
            ? _value.entity
            : entity // ignore: cast_nullable_to_non_nullable
                  as GraphEntity,
        memories: null == memories
            ? _value._memories
            : memories // ignore: cast_nullable_to_non_nullable
                  as List<EntityMemory>,
        relatedEntities: null == relatedEntities
            ? _value._relatedEntities
            : relatedEntities // ignore: cast_nullable_to_non_nullable
                  as List<RelatedEntity>,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$EntityDetailImpl implements _EntityDetail {
  const _$EntityDetailImpl({
    required this.entity,
    final List<EntityMemory> memories = const [],
    final List<RelatedEntity> relatedEntities = const [],
  }) : _memories = memories,
       _relatedEntities = relatedEntities;

  factory _$EntityDetailImpl.fromJson(Map<String, dynamic> json) =>
      _$$EntityDetailImplFromJson(json);

  @override
  final GraphEntity entity;
  final List<EntityMemory> _memories;
  @override
  @JsonKey()
  List<EntityMemory> get memories {
    if (_memories is EqualUnmodifiableListView) return _memories;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_memories);
  }

  final List<RelatedEntity> _relatedEntities;
  @override
  @JsonKey()
  List<RelatedEntity> get relatedEntities {
    if (_relatedEntities is EqualUnmodifiableListView) return _relatedEntities;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_relatedEntities);
  }

  @override
  String toString() {
    return 'EntityDetail(entity: $entity, memories: $memories, relatedEntities: $relatedEntities)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EntityDetailImpl &&
            (identical(other.entity, entity) || other.entity == entity) &&
            const DeepCollectionEquality().equals(other._memories, _memories) &&
            const DeepCollectionEquality().equals(
              other._relatedEntities,
              _relatedEntities,
            ));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    entity,
    const DeepCollectionEquality().hash(_memories),
    const DeepCollectionEquality().hash(_relatedEntities),
  );

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$EntityDetailImplCopyWith<_$EntityDetailImpl> get copyWith =>
      __$$EntityDetailImplCopyWithImpl<_$EntityDetailImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$EntityDetailImplToJson(this);
  }
}

abstract class _EntityDetail implements EntityDetail {
  const factory _EntityDetail({
    required final GraphEntity entity,
    final List<EntityMemory> memories,
    final List<RelatedEntity> relatedEntities,
  }) = _$EntityDetailImpl;

  factory _EntityDetail.fromJson(Map<String, dynamic> json) =
      _$EntityDetailImpl.fromJson;

  @override
  GraphEntity get entity;
  @override
  List<EntityMemory> get memories;
  @override
  List<RelatedEntity> get relatedEntities;

  /// Create a copy of EntityDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$EntityDetailImplCopyWith<_$EntityDetailImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
