# ERPNext - web based ERP (http://erpnext.com)
# Copyright (C) 2012 Web Notes Technologies Pvt Ltd
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.	See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.	If not, see <http://www.gnu.org/licenses/>.

from __future__ import unicode_literals
import webnotes


from webnotes.utils.nestedset import DocTypeNestedSet

class DocType(DocTypeNestedSet):
	def __init__(self, doc, doclist=[]):
		self.doc = doc
		self.doclist = doclist
		self.nsm_parent_field = 'parent_item_group';
	
	def on_update(self):
		if self.doc.show_in_website:
			# webpage updates
			from website.utils import update_page_name
			page_name = self.doc.name
			if webnotes.conn.get_value("Website Settings", None, 
				"default_product_category")==self.doc.name:
				page_name = "products"
				
			update_page_name(self.doc, self.doc.name)
	
	def prepare_template_args(self):
		self.doc.sub_groups = webnotes.conn.sql("""select name, page_name
			from `tabItem Group` where parent_item_group=%s
			and ifnull(show_in_website,0)=1""", self.doc.name, as_dict=1)		