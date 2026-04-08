import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static const _background = Color(0xFF0E0E18);
  static const _surface = Color(0xFF1A1A28);
  static const _surfaceVariant = Color(0xFF222232);
  static const _primary = Color(0xFF2244FF);
  static const _onPrimary = Color(0xFFFFFFFF);
  static const _textPrimary = Color(0xFFFFFFFF);
  static const _textSecondary = Color(0xFF888888);
  static const _error = Color(0xFFFF4444);
  static const _border = Color(0xFF2A2A2A);

  static ThemeData dark() {
    final colorScheme = ColorScheme.dark(
      surface: _surface,
      primary: _primary,
      onPrimary: _onPrimary,
      secondary: _surfaceVariant,
      onSecondary: _textPrimary,
      error: _error,
      onError: _onPrimary,
      onSurface: _textPrimary,
      outline: _border,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: _background,
      appBarTheme: const AppBarTheme(
        backgroundColor: _background,
        foregroundColor: _textPrimary,
        elevation: 0,
        centerTitle: false,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: _background,
        selectedItemColor: _primary,
        unselectedItemColor: _textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: _surfaceVariant,
        border: OutlineInputBorder(
          borderSide: const BorderSide(color: _border),
          borderRadius: BorderRadius.circular(10),
        ),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: _border),
          borderRadius: BorderRadius.circular(10),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: _primary),
          borderRadius: BorderRadius.circular(10),
        ),
        hintStyle: const TextStyle(color: _textSecondary),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: _primary,
          foregroundColor: _onPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }
}
