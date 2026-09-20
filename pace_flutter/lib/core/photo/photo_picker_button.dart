import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'photo_picker_service.dart';

class PhotoPickerButton extends StatefulWidget {
  const PhotoPickerButton({super.key, required this.onChanged, this.initialValue});

  final ValueChanged<XFile?> onChanged;
  final XFile? initialValue;

  @override
  State<PhotoPickerButton> createState() => _PhotoPickerButtonState();
}

class _PhotoPickerButtonState extends State<PhotoPickerButton> {
  final _service = PhotoPickerService();
  XFile? _selected;
  Uint8List? _preview;
  bool _loading = false;

  XFile? get _value => _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.initialValue;
    _loadPreview(_selected);
  }

  @override
  void didUpdateWidget(covariant PhotoPickerButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialValue != widget.initialValue) {
      _selected = widget.initialValue;
      _loadPreview(_selected);
    }
  }

  Future<void> _loadPreview(XFile? file) async {
    if (file == null) {
      if (mounted) setState(() => _preview = null);
      return;
    }
    try {
      final bytes = await file.readAsBytes();
      if (mounted) setState(() => _preview = bytes);
    } catch (_) {
      if (mounted) setState(() => _preview = null);
    }
  }

  Future<void> _choose() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Prendre une photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choisir dans la galerie'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.close),
              title: const Text('Annuler'),
              onTap: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    setState(() => _loading = true);
    try {
      final file = source == ImageSource.camera ? await _service.pickFromCamera() : await _service.pickFromGallery();
      if (!mounted) return;
      if (file != null) {
        setState(() {
          _selected = file;
          _loading = false;
        });
        await _loadPreview(file);
        widget.onChanged(file);
      } else {
        setState(() => _loading = false);
      }
    } on PhotoPickerException catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  void _remove() {
    setState(() {
      _selected = null;
      _preview = null;
    });
    widget.onChanged(null);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _value;
    if (selected == null) {
      return Align(
        alignment: Alignment.centerLeft,
        child: IconButton.filledTonal(
          tooltip: 'Ajouter une photo',
          onPressed: _loading ? null : _choose,
          icon: _loading ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add),
        ),
      );
    }

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_preview != null) AspectRatio(aspectRatio: 16 / 9, child: Image.memory(_preview!, fit: BoxFit.cover)),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                Expanded(child: Text(selected.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                IconButton(tooltip: 'Remplacer', onPressed: _loading ? null : _choose, icon: const Icon(Icons.refresh)),
                IconButton(tooltip: 'Supprimer', onPressed: _remove, icon: const Icon(Icons.delete_outline)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
