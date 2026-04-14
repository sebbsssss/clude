import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_state.freezed.dart';

enum AuthMode { apiKey, privy }

@freezed
class AuthState with _$AuthState {
  const factory AuthState({
    @Default(false) bool isAuthenticated,
    @Default(false) bool isGuest,
    String? cortexKey,
    String? walletAddress,
    AuthMode? authMode,
    @Default(false) bool isLoading,
    String? error,
  }) = _AuthState;
}
