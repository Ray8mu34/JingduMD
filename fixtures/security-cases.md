# 安全边界测试

以下内容不应执行脚本或越过当前根目录：

<script>alert('never')</script>

[危险链接](javascript:alert('never'))

![私有网络](http://127.0.0.1/private.png)

![超大远程图片](https://example.invalid/oversized.png)

![目录外图片](../../outside.png)

