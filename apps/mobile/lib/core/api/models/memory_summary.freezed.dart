// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'memory_summary.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

MemorySummary _$MemorySummaryFromJson(Map<String, dynamic> json) {
  return _MemorySummary.fromJson(json);
}

/// @nodoc
mixin _$MemorySummary {
  int get id => throw _privateConstructorUsedError;
  @JsonKey(name: 'memory_type')
  String get memoryType => throw _privateConstructorUsedError;
  String get summary => throw _privateConstructorUsedError;
  double get importance => throw _privateConstructorUsedError;
  @JsonKey(name: 'created_at')
  String get createdAt => throw _privateConstructorUsedError;

  /// Serializes this MemorySummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of MemorySummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MemorySummaryCopyWith<MemorySummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MemorySummaryCopyWith<$Res> {
  factory $MemorySummaryCopyWith(
    MemorySummary value,
    $Res Function(MemorySummary) then,
  ) = _$MemorySummaryCopyWithImpl<$Res, MemorySummary>;
  @useResult
  $Res call({
    int id,
    @JsonKey(name: 'memory_type') String memoryType,
    String summary,
    double importance,
    @JsonKey(name: 'created_at') String createdAt,
  });
}

/// @nodoc
class _$MemorySummaryCopyWithImpl<$Res, $Val extends MemorySummary>
    implements $MemorySummaryCopyWith<$Res> {
  _$MemorySummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MemorySummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memoryType = null,
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
            memoryType: null == memoryType
                ? _value.memoryType
                : memoryType // ignore: cast_nullable_to_non_nullable
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
abstract class _$$MemorySummaryImplCopyWith<$Res>
    implements $MemorySummaryCopyWith<$Res> {
  factory _$$MemorySummaryImplCopyWith(
    _$MemorySummaryImpl value,
    $Res Function(_$MemorySummaryImpl) then,
  ) = __$$MemorySummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    int id,
    @JsonKey(name: 'memory_type') String memoryType,
    String summary,
    double importance,
    @JsonKey(name: 'created_at') String createdAt,
  });
}

/// @nodoc
class __$$MemorySummaryImplCopyWithImpl<$Res>
    extends _$MemorySummaryCopyWithImpl<$Res, _$MemorySummaryImpl>
    implements _$$MemorySummaryImplCopyWith<$Res> {
  __$$MemorySummaryImplCopyWithImpl(
    _$MemorySummaryImpl _value,
    $Res Function(_$MemorySummaryImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MemorySummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memoryType = null,
    Object? summary = null,
    Object? importance = null,
    Object? createdAt = null,
  }) {
    return _then(
      _$MemorySummaryImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as int,
        memoryType: null == memoryType
            ? _value.memoryType
            : memoryType // ignore: cast_nullable_to_non_nullable
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
class _$MemorySummaryImpl implements _MemorySummary {
  const _$MemorySummaryImpl({
    required this.id,
    @JsonKey(name: 'memory_type') required this.memoryType,
    required this.summary,
    required this.importance,
    @JsonKey(name: 'created_at') required this.createdAt,
  });

  factory _$MemorySummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$MemorySummaryImplFromJson(json);

  @override
  final int id;
  @override
  @JsonKey(name: 'memory_type')
  final String memoryType;
  @override
  final String summary;
  @override
  final double importance;
  @override
  @JsonKey(name: 'created_at')
  final String createdAt;

  @override
  String toString() {
    return 'MemorySummary(id: $id, memoryType: $memoryType, summary: $summary, importance: $importance, createdAt: $createdAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MemorySummaryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.memoryType, memoryType) ||
                other.memoryType == memoryType) &&
            (identical(other.summary, summary) || other.summary == summary) &&
            (identical(other.importance, importance) ||
                other.importance == importance) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, memoryType, summary, importance, createdAt);

  /// Create a copy of MemorySummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MemorySummaryImplCopyWith<_$MemorySummaryImpl> get copyWith =>
      __$$MemorySummaryImplCopyWithImpl<_$MemorySummaryImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$MemorySummaryImplToJson(this);
  }
}

abstract class _MemorySummary implements MemorySummary {
  const factory _MemorySummary({
    required final int id,
    @JsonKey(name: 'memory_type') required final String memoryType,
    required final String summary,
    required final double importance,
    @JsonKey(name: 'created_at') required final String createdAt,
  }) = _$MemorySummaryImpl;

  factory _MemorySummary.fromJson(Map<String, dynamic> json) =
      _$MemorySummaryImpl.fromJson;

  @override
  int get id;
  @override
  @JsonKey(name: 'memory_type')
  String get memoryType;
  @override
  String get summary;
  @override
  double get importance;
  @override
  @JsonKey(name: 'created_at')
  String get createdAt;

  /// Create a copy of MemorySummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MemorySummaryImplCopyWith<_$MemorySummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
